<script lang="ts">
  import { tick } from "svelte";
  import { fade, scale } from "svelte/transition";
  import { backdropFade, cardPop } from "$lib/motion";
  import { paletteOpen, paletteHintMode, paletteIntent, closePalette } from "$lib/stores/palette";
  import {
    fullTextIndexReady,
    indexBuilding,
    fullTextLoading,
    pendingFullTextVault,
  } from "$lib/stores/search";
  import { unifiedSearch, groupResults, type PaletteResult, type PaletteEntry } from "$lib/palette";
  import { selectNote, ensureFullTextIndex } from "$lib/stores/vault";
  import { selectTag, showTagsTab } from "$lib/stores/tags";
  import { toggleDocKind, toggleTopic } from "$lib/stores/filters";

  let inputEl: HTMLInputElement | null = $state(null);
  let listEl: HTMLDivElement | null = $state(null);
  let query = $state("");
  let activeIndex = $state(0);

  /** 검색 디바운스(ms) — 빠른 타이핑 시 키 입력마다 풀검색(searchQuick 12k + readNote×N) 방지. */
  const SEARCH_DEBOUNCE_MS = 90;

  // 키보드 탐색 중에는 mouseenter를 무시 — 컨테이너가 스크롤되면 마우스 좌표가 그대로여도
  // 새로 화면에 들어온 항목 위에 커서가 위치하게 되어 mouseenter가 발화, activeIndex가
  // 의도와 반대로 바뀌는 hijacking을 막는다. 마우스가 실제로 움직이면 모드 해제.
  let keyboardNavMode = $state(false);
  let lastMouseXY = { x: -1, y: -1 };

  // 모달 열릴 때 초기화 + 포커스
  $effect(() => {
    if ($paletteOpen) {
      query = "";
      activeIndex = 0;
      keyboardNavMode = false;
      lastMouseXY = { x: -1, y: -1 };
      tick().then(() => inputEl?.focus());
      // cold-start cache hit 직후 fullTextIndex가 lazy 빌드 대기 상태일 수 있음.
      // idle callback이 아직 안 돌았으면 여기서 즉시 트리거 — 사용자가 검색을 시작
      // 하기 전에 백그라운드 빌드 시작. ensureFullTextIndex는 idempotent.
      void Promise.resolve().then(() => ensureFullTextIndex());
    }
  });

  // 모달 열린 동안 window mousemove로 실제 마우스 이동 감지 → 키보드 모드 해제
  $effect(() => {
    if (!$paletteOpen) return;
    const onMove = (e: MouseEvent) => {
      if (e.clientX !== lastMouseXY.x || e.clientY !== lastMouseXY.y) {
        lastMouseXY = { x: e.clientX, y: e.clientY };
        keyboardNavMode = false;
      }
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  });

  // unifiedSearch가 async (matchContent가 readNote × N 동반)이라 $derived 대신 $state + $effect.
  // cancellation으로 빠른 타이핑 시 stale 결과 덮어쓰기 방지.
  let results = $state<PaletteResult[]>([]);

  $effect(() => {
    if (!$paletteOpen) {
      results = [];
      return;
    }
    const q = query;
    const hint = $paletteHintMode;
    let cancelled = false;
    // 빈 입력(Recent/Quick Actions)은 즉시, 입력이 있으면 디바운스 — 타이핑 중 매 키마다
    // 풀검색이 도는 것을 막아 입력 지연을 없앤다. 다음 키 입력이 timer를 clear하므로
    // 입력이 멈춘 뒤 1회만 실행. cancelled로 stale 결과 덮어쓰기도 차단(이중 안전).
    const delay = q.trim() === "" ? 0 : SEARCH_DEBOUNCE_MS;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const r = await unifiedSearch(q, hint);
          if (!cancelled) results = r;
        } catch (e) {
          if (!cancelled) {
            console.warn("unifiedSearch failed", e);
            results = [];
          }
        }
      })();
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  const groups = $derived(groupResults(results));

  // 화면 그리는 순서대로 평면화한 배열. activeIndex는 이 배열의 인덱스(시각적 순서)를 사용해야
  // ↑/↓ 탐색이 자연스럽게 동작한다. results(점수 순)와 다름에 주의.
  const displayList = $derived.by<PaletteResult[]>(() => {
    const out: PaletteResult[] = [];
    if (showRecents) out.push(...groups.recents);
    if (showNotes) out.push(...groups.notes);
    if (showContent) out.push(...groups.content);
    if (showTagsGroup) out.push(...groups.tags);
    if (showFacets) out.push(...groups.facets);
    if (showCommands) out.push(...groups.commands);
    return out;
  });

  const indexByEntry = $derived.by(() => {
    const m = new Map<PaletteEntry, number>();
    displayList.forEach((r, i) => m.set(r.entry, i));
    return m;
  });

  function displayIndexOf(entry: PaletteEntry): number {
    return indexByEntry.get(entry) ?? -1;
  }

  // active 인덱스가 범위 벗어나면 보정
  $effect(() => {
    const len = displayList.length;
    if (activeIndex >= len) activeIndex = Math.max(0, len - 1);
  });

  // active 항목 가시 영역 유지 + sticky 그룹 헤더 뒤에 가려지지 않도록 보정
  $effect(() => {
    const _ = activeIndex;
    if (!listEl) return;
    tick().then(() => {
      if (!listEl) return;
      const el = listEl.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "nearest" });

      // sticky 헤더(.group-header)들 중 활성 항목 위에 있는 헤더의 최하단보다 항목 top이
      // 위라면 그만큼 추가로 위로 스크롤 — 그래야 헤더에 가려지지 않는다.
      const elRect = el.getBoundingClientRect();
      const headers = listEl.querySelectorAll<HTMLElement>(".group-header");
      let coverBottom = listEl.getBoundingClientRect().top;
      for (const h of headers) {
        const hRect = h.getBoundingClientRect();
        // 활성 항목 영역까지 sticky로 머물러 있는 헤더만 후보
        if (hRect.top <= elRect.top && hRect.bottom > coverBottom) {
          coverBottom = hRect.bottom;
        }
      }
      if (elRect.top < coverBottom) {
        listEl.scrollTop -= coverBottom - elRect.top;
      }
    });
  });

  // placeholder — hint mode와 prefix에 따라 안내
  const placeholder = $derived.by(() => {
    if ($paletteHintMode === "files") return "파일명·alias·title…";
    if ($paletteHintMode === "fulltext") return "본문 키워드…";
    if (query.startsWith(">")) return "> 명령 검색";
    if (query.startsWith("#")) return "# 태그 검색";
    if (query.startsWith(":")) return ": doc_kind / topic 필터";
    return "통합 검색 — > 명령, # 태그, : facet";
  });

  // 활성 결과 실행
  async function execute(idx: number) {
    const r = displayList[idx];
    if (!r) return;
    const entry = r.entry;
    switch (entry.kind) {
      case "note":
      case "content":
      case "recent":
        // ⌘P로 연 팔레트만 활성 탭을 갈아끼운다. ⌘K·⌘T는 탭을 추가.
        await selectNote(entry.path, {
          replaceCurrentTab: $paletteIntent === "replace",
        });
        closePalette();
        break;
      case "tag":
        selectTag(entry.key, entry.mode);
        showTagsTab();
        closePalette();
        break;
      case "facet":
        if (entry.field === "doc_kind") toggleDocKind(entry.value);
        else toggleTopic(entry.value);
        closePalette();
        break;
      case "command":
        // 명령 자체가 다른 모달을 열 수 있음 — 팔레트 먼저 닫고 실행
        closePalette();
        await Promise.resolve(entry.command.run());
        break;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
      return;
    }
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      keyboardNavMode = true;
      activeIndex = Math.min(activeIndex + 1, Math.max(0, displayList.length - 1));
      return;
    }
    if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      keyboardNavMode = true;
      activeIndex = Math.max(activeIndex - 1, 0);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      void execute(activeIndex);
      return;
    }
  }

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) closePalette();
  }

  // command 안의 entry가 함수 ref라 매번 동일하지 않을 수 있어, 안정적인 key 생성
  function entryKey(entry: PaletteEntry): string {
    switch (entry.kind) {
      case "note":
      case "content":
      case "recent":
        return `${entry.kind}:${entry.path}`;
      case "tag":
        return `tag:${entry.mode}:${entry.key}`;
      case "facet":
        return `facet:${entry.field}:${entry.value}`;
      case "command":
        return `cmd:${entry.command.id}`;
    }
  }

  // hint 모드별 표시할 그룹 결정 (Cmd+P/Cmd+Shift+F는 단일 그룹)
  const showRecents = $derived(groups.recents.length > 0);
  const showNotes = $derived($paletteHintMode !== "fulltext" && groups.notes.length > 0);
  const showContent = $derived($paletteHintMode !== "files" && groups.content.length > 0);
  const showTagsGroup = $derived(
    ($paletteHintMode === "all" || $paletteHintMode === "tag") && groups.tags.length > 0,
  );
  const showFacets = $derived(
    ($paletteHintMode === "all" || $paletteHintMode === "facet") && groups.facets.length > 0,
  );
  const showCommands = $derived(
    ($paletteHintMode === "all" || $paletteHintMode === "command") && groups.commands.length > 0,
  );

  // 빈 입력 시 COMMANDS 그룹은 "QUICK ACTIONS"로 라벨
  const commandsHeaderLabel = $derived(query.trim() ? "COMMANDS" : "QUICK ACTIONS");

  // 풀텍스트 인덱스가 아직 준비 안 됨 — 두 가지 케이스:
  // 1) cold-start 풀 빌드 중 (`$indexBuilding`)
  // 2) cache hit 후 lazy load 진행 중 또는 대기 중 (`$fullTextLoading` || `$pendingFullTextJson`)
  const showContentBuildingHint = $derived(
    ($paletteHintMode === "fulltext" || $paletteHintMode === "all") &&
      !!query.trim() &&
      !$fullTextIndexReady &&
      ($indexBuilding || $fullTextLoading || !!$pendingFullTextVault),
  );
</script>

{#if $paletteOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={onBackdrop} transition:fade={backdropFade()}>
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      transition:scale={cardPop()}
    >
      <input
        bind:this={inputEl}
        type="text"
        class="palette-input"
        {placeholder}
        bind:value={query}
        onkeydown={onKeydown}
        autocomplete="off"
        spellcheck="false"
      />

      {#if showContentBuildingHint}
        <div class="status">본문 인덱스 빌드 중…</div>
      {:else if displayList.length === 0 && query}
        <div class="status">결과 없음</div>
      {:else if displayList.length === 0}
        <div class="status hint">
          입력해서 검색하세요. <kbd>&gt;</kbd> 명령 · <kbd>#</kbd> 태그 · <kbd>:</kbd> facet
        </div>
      {/if}

      <div class="results" bind:this={listEl}>
        {#if showRecents}
          <div class="group-header">RECENT</div>
          {#each groups.recents as r (entryKey(r.entry))}
            {@const e = r.entry}
            {#if e.kind === "recent"}
              {@const gi = displayIndexOf(e)}
              <button
                type="button"
                class="result"
                class:active={gi === activeIndex}
                data-idx={gi}
                onclick={() => execute(gi)}
                onmouseenter={() => { if (!keyboardNavMode) activeIndex = gi; }}
              >
                <div class="title">{e.label}</div>
                {#if e.subtitle}<div class="sub">{e.subtitle}</div>{/if}
              </button>
            {/if}
          {/each}
        {/if}

        {#if showNotes}
          <div class="group-header">NOTES</div>
          {#each groups.notes as r (entryKey(r.entry))}
            {@const e = r.entry}
            {#if e.kind === "note"}
              {@const gi = displayIndexOf(e)}
              <button
                type="button"
                class="result"
                class:active={gi === activeIndex}
                data-idx={gi}
                onclick={() => execute(gi)}
                onmouseenter={() => { if (!keyboardNavMode) activeIndex = gi; }}
              >
                <div class="title">{e.label}</div>
                {#if e.subtitle}<div class="sub">{e.subtitle}</div>{/if}
              </button>
            {/if}
          {/each}
        {/if}

        {#if showContent}
          <div class="group-header">CONTENT</div>
          {#each groups.content as r (entryKey(r.entry))}
            {@const e = r.entry}
            {#if e.kind === "content"}
              {@const gi = displayIndexOf(e)}
              <button
                type="button"
                class="result"
                class:active={gi === activeIndex}
                data-idx={gi}
                onclick={() => execute(gi)}
                onmouseenter={() => { if (!keyboardNavMode) activeIndex = gi; }}
              >
                <div class="title">{e.name}</div>
                <div class="snippet">{e.snippet}</div>
              </button>
            {/if}
          {/each}
        {/if}

        {#if showTagsGroup}
          <div class="group-header">TAGS</div>
          {#each groups.tags as r (entryKey(r.entry))}
            {@const e = r.entry}
            {#if e.kind === "tag"}
              {@const gi = displayIndexOf(e)}
              <button
                type="button"
                class="result"
                class:active={gi === activeIndex}
                data-idx={gi}
                onclick={() => execute(gi)}
                onmouseenter={() => { if (!keyboardNavMode) activeIndex = gi; }}
              >
                <div class="title">
                  #{e.display}
                  {#if e.mode === "prefix"}<span class="badge">prefix</span>{/if}
                </div>
                <div class="sub">{e.count} notes</div>
              </button>
            {/if}
          {/each}
        {/if}

        {#if showFacets}
          <div class="group-header">FACETS</div>
          {#each groups.facets as r (entryKey(r.entry))}
            {@const e = r.entry}
            {#if e.kind === "facet"}
              {@const gi = displayIndexOf(e)}
              <button
                type="button"
                class="result"
                class:active={gi === activeIndex}
                data-idx={gi}
                onclick={() => execute(gi)}
                onmouseenter={() => { if (!keyboardNavMode) activeIndex = gi; }}
              >
                <div class="title">
                  <span class="facet-field">{e.field}:</span> {e.value}
                </div>
                <div class="sub">{e.count} notes</div>
              </button>
            {/if}
          {/each}
        {/if}

        {#if showCommands}
          <div class="group-header">{commandsHeaderLabel}</div>
          {#each groups.commands as r (entryKey(r.entry))}
            {@const e = r.entry}
            {#if e.kind === "command"}
              {@const gi = displayIndexOf(e)}
              <button
                type="button"
                class="result"
                class:active={gi === activeIndex}
                data-idx={gi}
                onclick={() => execute(gi)}
                onmouseenter={() => { if (!keyboardNavMode) activeIndex = gi; }}
              >
                <div class="title">{e.command.label}</div>
                {#if e.command.shortcut}
                  <div class="shortcut">{e.command.shortcut}</div>
                {/if}
              </button>
            {/if}
          {/each}
        {/if}
      </div>

      <footer class="palette-foot">
        <span>↑↓ 탐색</span>
        <span>↵ 실행</span>
        <span>Esc 닫기</span>
      </footer>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 10vh;
    z-index: var(--z-modal);
  }

  .modal {
    width: min(680px, 92vw);
    max-height: 75vh;
    display: flex;
    flex-direction: column;
    background: var(--surface-overlay);
    border: 1px solid var(--border-default);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-overlay);
    overflow: hidden;
    color: var(--text-primary);
  }

  .palette-input {
    width: 100%;
    padding: 14px 18px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border-default);
    color: var(--text-primary);
    font-size: 15px;
    font-family: inherit;
    outline: none;
  }

  .palette-input::placeholder {
    color: var(--text-muted);
  }

  .status {
    padding: 18px;
    text-align: center;
    color: var(--text-muted);
    font-size: var(--fs-base);
  }

  .status.hint kbd {
    background: var(--surface-overlay);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-xs);
    padding: 1px 5px;
    margin: 0 var(--sp-1);
    color: var(--text-secondary);
    font-family: "SF Mono", Menlo, monospace;
    font-size: var(--fs-xs);
  }

  .results {
    overflow-y: auto;
    flex: 1;
    padding-bottom: var(--sp-2);
  }

  .group-header {
    position: sticky;
    top: 0;
    background: var(--surface-overlay);
    padding: var(--sp-4) 18px var(--sp-2);
    font-size: 10px;
    letter-spacing: 0.01em;
    color: var(--accent);
    font-weight: 600;
    z-index: 1;
  }

  .result {
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    padding: 7px 18px;
    color: inherit;
    font-family: inherit;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    position: relative;
  }

  .result.active {
    background: var(--accent-bg-subtle);
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .title {
    font-size: var(--fs-md);
    color: var(--text-primary);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    display: flex;
    align-items: center;
    gap: var(--sp-4);
  }

  .sub {
    font-size: var(--fs-xs);
    color: var(--text-muted);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .snippet {
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.4;
  }

  .badge {
    background: var(--accent-bg-subtle);
    color: var(--accent-hover);
    font-size: 10px;
    padding: 1px 5px;
    border-radius: var(--r-lg);
    font-weight: 500;
    text-transform: none;
    letter-spacing: normal;
  }

  .facet-field {
    color: var(--text-muted);
    font-weight: 500;
  }

  .shortcut {
    position: absolute;
    right: 18px;
    top: 50%;
    transform: translateY(-50%);
    font-family: "SF Mono", Menlo, monospace;
    font-size: var(--fs-xs);
    color: var(--text-muted);
    background: var(--surface-overlay);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-xs);
    padding: 1px var(--sp-3);
  }

  .palette-foot {
    display: flex;
    gap: var(--sp-6);
    justify-content: flex-end;
    padding: var(--sp-4) 14px;
    background: var(--surface-overlay);
    border-top: 1px solid var(--border-default);
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }
</style>
