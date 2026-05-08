<script lang="ts">
  import { tick } from "svelte";
  import {
    searchOpen,
    searchMode,
    quickEntries,
    fullTextIndex,
    indexBuilding,
    closeSearch,
    toggleSearchMode,
  } from "$lib/stores/search";
  import { selectNote } from "$lib/stores/vault";
  import {
    searchQuick,
    searchFullText,
    type QuickHit,
    type FullTextHit,
  } from "$lib/searchIndex";

  let inputEl: HTMLInputElement | null = $state(null);
  let listEl: HTMLUListElement | null = $state(null);
  let query = $state("");
  let activeIndex = $state(0);

  // 모달 열릴 때 초기화 + input 포커스
  $effect(() => {
    if ($searchOpen) {
      query = "";
      activeIndex = 0;
      tick().then(() => inputEl?.focus());
    }
  });

  // 결과 (mode에 따라)
  type Result =
    | { kind: "file"; hit: QuickHit }
    | { kind: "fulltext"; hit: FullTextHit };

  const results = $derived.by<Result[]>(() => {
    if (!$searchOpen) return [];
    if ($searchMode === "files") {
      return searchQuick(query, $quickEntries).map((hit) => ({ kind: "file" as const, hit }));
    } else {
      const idx = $fullTextIndex;
      if (!idx) return [];
      return searchFullText(query, idx).map((hit) => ({ kind: "fulltext" as const, hit }));
    }
  });

  // 결과 변할 때 active 인덱스 보정
  $effect(() => {
    const len = results.length;
    if (activeIndex >= len) activeIndex = Math.max(0, len - 1);
  });

  // active 항목 가시 영역 유지
  $effect(() => {
    const _ = activeIndex;
    if (!listEl) return;
    tick().then(() => {
      const el = listEl?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
      el?.scrollIntoView({ block: "nearest" });
    });
  });

  function pick(idx: number) {
    const r = results[idx];
    if (!r) return;
    const path = r.kind === "file" ? r.hit.entry.path : r.hit.path;
    selectNote(path);
    closeSearch();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
      return;
    }
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, Math.max(0, results.length - 1));
      return;
    }
    if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      pick(activeIndex);
      return;
    }
    // Cmd+T 같은 토글로 모드 스위치도 OK — 이번엔 Cmd+P/Cmd+Shift+F가 외부 단축키이므로 모달 안에선 토글 버튼만 제공
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) closeSearch();
  }

  function modeLabel(m: typeof $searchMode): string {
    return m === "files" ? "Files (Cmd+P)" : "Content (Cmd+Shift+F)";
  }

  function fileResultLabel(hit: QuickHit): string {
    return hit.entry.primaryLabel;
  }

  function fileResultSubtitle(hit: QuickHit): string {
    const parts: string[] = [];
    if (hit.matchedKey !== hit.entry.primaryLabel) parts.push(`alias: ${hit.matchedKey}`);
    if (hit.entry.parentPath) parts.push(hit.entry.parentPath);
    return parts.join(" · ");
  }
</script>

{#if $searchOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={onBackdropClick}>
    <div class="modal" role="dialog" aria-modal="true">
      <header class="modal-head">
        <span class="mode-label">{modeLabel($searchMode)}</span>
        <button
          class="mode-toggle"
          title={$searchMode === "files" ? "Content 모드로 전환" : "Files 모드로 전환"}
          onclick={toggleSearchMode}
        >
          {$searchMode === "files" ? "→ Content" : "→ Files"}
        </button>
      </header>

      <input
        bind:this={inputEl}
        type="text"
        class="search-input"
        placeholder={$searchMode === "files"
          ? "파일명·alias·title 검색…"
          : "본문 키워드 검색…"}
        bind:value={query}
        onkeydown={onKeydown}
        autocomplete="off"
        spellcheck="false"
      />

      {#if $searchMode === "fulltext" && $indexBuilding && results.length === 0}
        <div class="status">본문 인덱스를 빌드 중…</div>
      {:else if $searchMode === "fulltext" && !$fullTextIndex}
        <div class="status">vault를 먼저 선택하세요.</div>
      {:else if results.length === 0 && query}
        <div class="status">결과 없음</div>
      {/if}

      <ul class="results" bind:this={listEl}>
        {#each results as r, i (r.kind === "file" ? r.hit.entry.path : r.hit.path)}
          <li>
            <button
              type="button"
              class="result"
              class:active={i === activeIndex}
              data-idx={i}
              onclick={() => pick(i)}
              onmouseenter={() => (activeIndex = i)}
            >
              {#if r.kind === "file"}
                <div class="title">{fileResultLabel(r.hit)}</div>
                {#if fileResultSubtitle(r.hit)}
                  <div class="sub">{fileResultSubtitle(r.hit)}</div>
                {/if}
              {:else}
                <div class="title">{r.hit.name}</div>
                <div class="snippet">{r.hit.snippet}</div>
              {/if}
            </button>
          </li>
        {/each}
      </ul>

      <footer class="modal-foot">
        <span>↑↓ 탐색</span>
        <span>↵ 열기</span>
        <span>Esc 닫기</span>
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
    padding-top: 12vh;
    z-index: 1000;
  }

  .modal {
    width: min(680px, 92vw);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: #1f1f1f;
    border: 1px solid #3a3a3a;
    border-radius: 10px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    overflow: hidden;
    color: #e8e8e8;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    background: #2a2a2a;
    border-bottom: 1px solid #333;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #888;
  }

  .mode-label {
    font-weight: 600;
    color: #6dd6ff;
  }

  .mode-toggle {
    background: #2a2a2a;
    border: 1px solid #444;
    color: #ccc;
    padding: 3px 10px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
    text-transform: none;
    letter-spacing: normal;
  }

  .mode-toggle:hover {
    border-color: #6dd6ff;
    color: #fff;
  }

  .search-input {
    width: 100%;
    padding: 14px 18px;
    background: transparent;
    border: none;
    border-bottom: 1px solid #333;
    color: #fff;
    font-size: 15px;
    font-family: inherit;
    outline: none;
  }

  .search-input::placeholder {
    color: #666;
  }

  .status {
    padding: 18px;
    text-align: center;
    color: #777;
    font-size: 13px;
  }

  .results {
    list-style: none;
    margin: 0;
    padding: 6px 0;
    overflow-y: auto;
    max-height: 50vh;
  }

  .result {
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    padding: 8px 18px;
    color: inherit;
    font-family: inherit;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .result.active {
    background: #2d4a5a;
    box-shadow: inset 3px 0 0 #6dd6ff;
  }

  .title {
    font-size: 14px;
    color: #fff;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .sub {
    font-size: 11px;
    color: #888;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .snippet {
    font-size: 12px;
    color: #aaa;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.4;
  }

  .modal-foot {
    display: flex;
    gap: 16px;
    justify-content: flex-end;
    padding: 8px 14px;
    background: #2a2a2a;
    border-top: 1px solid #333;
    font-size: 11px;
    color: #888;
  }
</style>
