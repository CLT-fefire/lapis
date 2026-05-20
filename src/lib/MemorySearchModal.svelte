<script lang="ts">
  import { tick } from "svelte";
  import { memorySearchOpen, closeMemorySearch } from "$lib/stores/memorySearch";
  import { vaultPath, selectNote } from "$lib/stores/vault";
  import { loadVaultConfig } from "$lib/vaultConfig";
  import { memoryFindExportedNote } from "$lib/tauri/memory";
  import { mirrorQueryMemories, type MirrorSearchHit } from "$lib/tauri/mirror";

  let inputEl: HTMLInputElement | undefined = $state();
  let resultsEl: HTMLDivElement | undefined = $state();
  let query = $state("");
  let hits: MirrorSearchHit[] = $state([]);
  let activeIndex = $state(0);
  let loading = $state(false);
  let errorMsg = $state("");

  // type 필터 토글 — 둘 다 기본 true. 사용자가 한 쪽만 보고 싶을 때 끔.
  let includeSummaries = $state(true);
  let includeObservations = $state(true);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // 키보드 네비 모드 — true면 mouseenter는 activeIndex를 변경하지 않는다.
  // 이유: 키보드 ↓로 스크롤되면 가만히 있는 마우스 커서 위치에 새로운 row가 등장 →
  //   mouseenter가 발화 → activeIndex hijack. CommandPalette.svelte와 동일 패턴.
  let keyboardNavMode = $state(false);
  let lastMouseXY = { x: -1, y: -1 };

  // 모달 열릴 때 초기화 + 포커스
  $effect(() => {
    if ($memorySearchOpen) {
      query = "";
      hits = [];
      activeIndex = 0;
      errorMsg = "";
      keyboardNavMode = false;
      lastMouseXY = { x: -1, y: -1 };
      void tick().then(() => inputEl?.focus());
    } else {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    }
  });

  // 모달 열린 동안 실제 마우스 이동 감지 → 키보드 모드 해제.
  // 스크롤로 인한 mouseenter는 좌표가 그대로라 발화해도 무시된다.
  $effect(() => {
    if (!$memorySearchOpen) return;
    const onMove = (e: MouseEvent) => {
      if (e.clientX !== lastMouseXY.x || e.clientY !== lastMouseXY.y) {
        lastMouseXY = { x: e.clientX, y: e.clientY };
        keyboardNavMode = false;
      }
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  });

  /**
   * FTS5 검색의 최소 query 길이.
   * 1자: 매치 doc 수천 → bm25 채점 수 초 ("a" = 6.3s, "m" = 3s 측정).
   * 2자: 여전히 prefix 매치 doc 많음 ("at", "wa", "mi"). 3자부터 의미 있는 토큰.
   */
  const MIN_QUERY_LEN = 3;

  /** debounce 시간 — 사용자 타이핑 갭. 300ms가 빠른 타이핑 중 발화 안 되는 적정값. */
  const SEARCH_DEBOUNCE_MS = 300;

  // 입력 변경 OR 토글 변경 → debounce 후 검색
  $effect(() => {
    if (!$memorySearchOpen) return;
    const q = query;
    // 토글 reactive 추적 — 토글 변경 시도 검색 재실행
    const incS = includeSummaries;
    const incO = includeObservations;
    if (debounceTimer) clearTimeout(debounceTimer);
    const trimmed = q.trim();
    if (!trimmed) {
      hits = [];
      loading = false;
      errorMsg = "";
      return;
    }
    if (trimmed.length < MIN_QUERY_LEN) {
      hits = [];
      loading = false;
      errorMsg = `최소 ${MIN_QUERY_LEN}자 이상 입력해주세요.`;
      return;
    }
    if (!incS && !incO) {
      hits = [];
      loading = false;
      errorMsg = "검색 type을 하나 이상 선택해주세요.";
      return;
    }
    // 검색 진입 OK — stale hint(이전 1-2자에서 set된 "최소 N자..." 등) 즉시 clear.
    // debounce 콜백에서 clear하면 발화 전까지 stale hint가 보임 → 빠른 타이핑 UX 깨짐.
    errorMsg = "";
    loading = true;
    debounceTimer = setTimeout(async () => {
      // dev 모드 측정 — 검색 트리거(invoke 직전)~결과 set까지 wall clock.
      // 사용자 perceived 응답성 추적용. release 빌드는 dead code.
      const t0 = import.meta.env.DEV ? performance.now() : 0;
      try {
        const vault = $vaultPath;
        const filter = vault ? (await loadVaultConfig(vault)).mem_projects : ["*"];
        const result = await mirrorQueryMemories(q, filter, 30, incS, incO);
        if (q !== query) return; // 이후 입력이 오면 결과 폐기
        hits = result;
        activeIndex = 0;
        errorMsg = "";
        if (import.meta.env.DEV) {
          const dt = performance.now() - t0;
          console.debug(
            `[lapis-perf] mem-search q="${q}" hits=${result.length} dt=${dt.toFixed(1)}ms`,
          );
        }
      } catch (e) {
        errorMsg = `검색 실패: ${e}`;
        hits = [];
      } finally {
        loading = false;
      }
    }, SEARCH_DEBOUNCE_MS);
  });

  async function jumpTo(hit: MirrorSearchHit) {
    const vault = $vaultPath;
    if (!vault) {
      errorMsg = "vault가 닫혔습니다.";
      return;
    }
    try {
      // memoryFindExportedNote는 claude-mem 원본 id 기대 → mirror의 source_id 전달
      const path = await memoryFindExportedNote(vault, hit.source_id, hit.type);
      if (!path) {
        errorMsg = `메모리 노트를 찾을 수 없습니다 (${hit.type} mem_id=${hit.source_id}). Memory: Sync를 먼저 실행해 export 했는지 확인하세요.`;
        return;
      }
      closeMemorySearch();
      void selectNote(path);
    } catch (e) {
      errorMsg = `점프 실패: ${e}`;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeMemorySearch();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      keyboardNavMode = true;
      if (hits.length > 0) activeIndex = (activeIndex + 1) % hits.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      keyboardNavMode = true;
      if (hits.length > 0)
        activeIndex = (activeIndex - 1 + hits.length) % hits.length;
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[activeIndex];
      if (hit) void jumpTo(hit);
    }
  }

  // activeIndex 변경 시 해당 .hit element를 results 컨테이너 안에 보이도록 스크롤.
  // 표준 scrollIntoView({block:'nearest'})로 컨테이너 자동 감지 + 최소 이동.
  $effect(() => {
    const _ = activeIndex;
    if (!resultsEl) return;
    const el = resultsEl.children[activeIndex] as HTMLElement | undefined;
    if (!el) return;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) closeMemorySearch();
  }

  function shortDate(iso: string): string {
    return iso.length >= 10 ? iso.slice(0, 10) : iso;
  }
</script>

{#if $memorySearchOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={onBackdrop}>
    <div class="modal" role="dialog" aria-modal="true">
      <header>
        <input
          bind:this={inputEl}
          type="text"
          placeholder="메모리 검색 (FTS5 풀텍스트)"
          bind:value={query}
          onkeydown={handleKeydown}
          spellcheck="false"
          autocomplete="off"
        />
        <span class="status">
          {#if loading}
            검색 중…
          {:else if query && hits.length === 0 && !errorMsg}
            결과 없음
          {:else if hits.length > 0}
            {hits.length}건
          {/if}
        </span>
      </header>

      <div class="filters">
        <label>
          <input type="checkbox" bind:checked={includeSummaries} />
          <span class="kind summary">summary</span>
        </label>
        <label>
          <input type="checkbox" bind:checked={includeObservations} />
          <span class="kind obs">obs</span>
        </label>
      </div>

      {#if errorMsg}
        <div class="err">{errorMsg}</div>
      {/if}

      <div class="results" bind:this={resultsEl}>
        {#each hits as hit, i (`${hit.type}-${hit.source_id}`)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="hit"
            class:active={i === activeIndex}
            onmouseenter={() => {
              if (!keyboardNavMode) activeIndex = i;
            }}
            onclick={() => jumpTo(hit)}
          >
            <div class="hit-head">
              <span class="kind {hit.type === 'observation' ? 'obs' : 'summary'}">
                {hit.type === "observation" ? "obs" : "summary"}
              </span>
              <span class="title">{hit.title_hint}</span>
              <span class="meta">{hit.project} · {shortDate(hit.created_at)}</span>
            </div>
            <div class="snippet">{@html hit.snippet_html}</div>
          </div>
        {/each}
      </div>

      <footer class="hint">
        ↑↓ 이동 · ↵ 열기 · Esc 닫기 · FTS5 풀텍스트 검색 (한국어는 어절 단위)
      </footer>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    z-index: 1100;
    padding-top: 12vh;
  }

  .modal {
    width: min(640px, 92vw);
    max-height: 76vh;
    background: #1f1f1f;
    border: 1px solid #3a3a3a;
    border-radius: 10px;
    color: #e8e8e8;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid #333;
  }

  input {
    flex: 1;
    background: #1a1a1a;
    border: 1px solid #3a3a3a;
    border-radius: 5px;
    color: #e8e8e8;
    padding: 6px 10px;
    font-size: 13px;
    outline: none;
  }

  input:focus {
    border-color: #6dd6ff;
  }

  .status {
    color: #888;
    font-size: 11px;
    min-width: 60px;
    text-align: right;
  }

  .err {
    padding: 8px 12px;
    color: #f47174;
    font-size: 12px;
    border-bottom: 1px solid #2a1818;
    background: rgba(244, 113, 116, 0.06);
  }

  .results {
    flex: 1;
    overflow-y: auto;
  }

  .hit {
    padding: 10px 12px;
    border-bottom: 1px solid #2a2a2a;
    cursor: pointer;
  }

  .hit.active {
    background: rgba(109, 214, 255, 0.08);
  }

  .hit-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 4px;
  }

  /* kind 배지 — MemorySyncModal과 톤 통일 */
  .kind {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .kind.summary {
    background: rgba(168, 119, 232, 0.18);
    color: #c4a3ff;
    border: 1px solid rgba(168, 119, 232, 0.35);
  }

  .kind.obs {
    background: rgba(73, 216, 196, 0.16);
    color: #7be4cf;
    border: 1px solid rgba(73, 216, 196, 0.35);
  }

  .filters {
    display: flex;
    gap: 14px;
    padding: 6px 12px;
    border-bottom: 1px solid #2a2a2a;
    font-size: 11px;
    background: #181818;
  }

  .filters label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
    user-select: none;
  }

  .filters input[type="checkbox"] {
    accent-color: #6dd6ff;
    cursor: pointer;
    margin: 0;
  }

  .title {
    font-size: 13px;
    font-weight: 600;
    color: #e8e8e8;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    color: #888;
    font-size: 11px;
    flex-shrink: 0;
  }

  .snippet {
    color: #bbb;
    font-size: 12px;
    line-height: 1.5;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
  }

  .snippet :global(mark) {
    background: rgba(255, 200, 0, 0.35);
    color: inherit;
    padding: 0 1px;
    border-radius: 2px;
  }

  footer.hint {
    padding: 6px 12px;
    border-top: 1px solid #333;
    color: #666;
    font-size: 11px;
  }
</style>
