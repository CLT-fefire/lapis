<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import ModalShell from "$lib/ModalShell.svelte";
  import { ArrowDown, ArrowUp, Plus, X, ChevronLeft, ChevronRight } from "@lucide/svelte";
  import {
    tableViewOpen,
    closeTableView,
    activeColumns,
    activeSort,
    activeDocKinds,
    activeTopics,
    activeText,
    renderLimit,
    RENDER_STEP,
    toggleSort,
    toggleColumn,
    moveColumn,
    toggleTableDocKind,
    toggleTableTopic,
    clearTableFilters,
    savedViews,
    saveCurrentView,
    applySavedView,
    deleteSavedView,
    showMore,
  } from "$lib/stores/tableView";
  import {
    availableColumns,
    cellValue,
    filterRows,
    isBuiltinColumn,
    sortRows,
    type ColumnKey,
  } from "$lib/tableView";
  import { linkIndex, vaultPath, selectNote } from "$lib/stores/vault";
  import { docKindCounts, topicCounts } from "$lib/stores/filters";

  let columnMenuOpen = $state(false);
  let viewName = $state("");

  const infos = $derived.by(() => {
    const idx = $linkIndex;
    return idx ? [...idx.byPath.values()] : [];
  });

  const rows = $derived.by(() => {
    const root = $vaultPath ?? "";
    const filtered = filterRows(
      infos,
      { docKinds: $activeDocKinds, topics: $activeTopics, text: $activeText },
      root,
    );
    return sortRows(filtered, $activeSort, root);
  });

  const shown = $derived(rows.slice(0, $renderLimit));
  const addable = $derived(
    availableColumns(infos).filter((c) => !$activeColumns.includes(c.key)),
  );

  /**
   * ⚠️ 붙박이 컬럼만 번역한다. frontmatter 키는 vault가 정하는 이름이라 번역 대상이
   * 아니고, 번역했다가는 화면의 이름과 파일 안의 키가 달라져 되짚을 수 없다.
   */
  function columnLabel(key: ColumnKey): string {
    switch (key) {
      case "title": return m.table_col_title();
      case "doc_kind": return m.table_col_doc_kind();
      case "topic": return m.table_col_topic();
      case "tags": return m.table_col_tags();
      case "path": return m.table_col_path();
      default: return key;
    }
  }

  /**
   * 컬럼 메뉴 바깥 클릭 닫기 — 좌클릭만(WKWebView가 우클릭 mouseup을 click으로 넘기는
   * 것을 피한다. `ContextMenu`·`NavHistoryMenu`와 같은 패턴).
   *
   * ⚠️ Escape는 여기서 처리하지 않는다. `ModalShell`이 Escape로 **모달 전체**를 닫는데,
   * 메뉴만 닫으려고 여기서 가로채면 모달이 안 닫히는 상태가 생긴다. 메뉴는 바깥 클릭과
   * 항목 선택으로만 닫는다.
   */
  function onWindowMouseDown(e: MouseEvent): void {
    if (e.button !== 0 || !columnMenuOpen) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest(".menu-wrap")) return;
    columnMenuOpen = false;
  }

  function open(path: string): void {
    void selectNote(path);
    closeTableView();
  }

  function submitSave(): void {
    saveCurrentView(viewName);
    viewName = "";
  }

  const sortedDocKinds = $derived(
    [...$docKindCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
  const sortedTopics = $derived(
    [...$topicCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20),
  );
</script>

<svelte:window onmousedown={onWindowMouseDown} />

{#if $tableViewOpen}
  <ModalShell onClose={closeTableView} align="top" label={m.table_aria()}>
    <div class="modal" role="dialog" aria-modal="true" aria-label={m.table_aria()}>
      <header class="modal-head">
        <span>{m.table_title()}</span>
        <button
          class="btn btn--icon btn--sm btn--plain"
          onclick={closeTableView}
          title={m.table_close()}
          aria-label={m.table_close()}>×</button
        >
      </header>

      <div class="toolbar">
        <input
          class="search"
          type="search"
          data-autofocus
          bind:value={$activeText}
          placeholder={m.table_search_placeholder()}
        />
        <div class="spacer"></div>
        <div class="menu-wrap">
          <button
            class="btn btn--sm"
            aria-expanded={columnMenuOpen}
            onclick={() => (columnMenuOpen = !columnMenuOpen)}
          >
            {m.table_columns()} ({$activeColumns.length})
          </button>
          {#if columnMenuOpen}
            <div class="menu" role="menu">
              <p class="menu-head">{m.table_columns_add()}</p>
              {#each addable as col (col.key)}
                <button class="menu-item" role="menuitem" onclick={() => toggleColumn(col.key)}>
                  <Plus size={13} aria-hidden="true" />
                  <span class="k">{columnLabel(col.key)}</span>
                  <span class="n">{col.count}</span>
                </button>
              {:else}
                <p class="menu-empty">—</p>
              {/each}
            </div>
          {/if}
        </div>
        <button class="btn btn--sm btn--plain" onclick={clearTableFilters}>
          {m.table_clear_filters()}
        </button>
      </div>

      <div class="facets">
        {#each sortedDocKinds as [kind, n] (kind)}
          <button
            class="chip"
            class:on={$activeDocKinds.has(kind)}
            aria-pressed={$activeDocKinds.has(kind)}
            onclick={() => toggleTableDocKind(kind)}>{kind} <span class="n">{n}</span></button
          >
        {/each}
        {#each sortedTopics as [topic, n] (topic)}
          <button
            class="chip chip--topic"
            class:on={$activeTopics.has(topic)}
            aria-pressed={$activeTopics.has(topic)}
            onclick={() => toggleTableTopic(topic)}>{topic} <span class="n">{n}</span></button
          >
        {/each}
      </div>

      <div class="table-wrap">
        {#if $activeColumns.length === 0}
          <p class="empty">{m.table_no_columns()}</p>
        {:else if rows.length === 0}
          <p class="empty">{m.table_empty()}</p>
        {:else}
          <table>
            <thead>
              <tr>
                {#each $activeColumns as key, i (key)}
                  <th aria-sort={$activeSort?.key === key
                    ? ($activeSort.dir === "asc" ? "ascending" : "descending")
                    : "none"}>
                    <div class="th">
                      <button class="sort" onclick={() => toggleSort(key)}>
                        <span class:builtin={isBuiltinColumn(key)}>{columnLabel(key)}</span>
                        {#if $activeSort?.key === key}
                          {#if $activeSort.dir === "asc"}
                            <ArrowUp size={12} aria-label={m.table_sort_asc()} />
                          {:else}
                            <ArrowDown size={12} aria-label={m.table_sort_desc()} />
                          {/if}
                        {/if}
                      </button>
                      <span class="col-ops">
                        <button
                          class="op"
                          disabled={i === 0}
                          title={m.table_column_move_left()}
                          aria-label={m.table_column_move_left()}
                          onclick={() => moveColumn(key, -1)}><ChevronLeft size={11} /></button
                        >
                        <button
                          class="op"
                          disabled={i === $activeColumns.length - 1}
                          title={m.table_column_move_right()}
                          aria-label={m.table_column_move_right()}
                          onclick={() => moveColumn(key, 1)}><ChevronRight size={11} /></button
                        >
                        <button
                          class="op"
                          title={m.table_column_remove()}
                          aria-label={m.table_column_remove()}
                          onclick={() => toggleColumn(key)}><X size={11} /></button
                        >
                      </span>
                    </div>
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each shown as info (info.source_path)}
                <tr onclick={() => open(info.source_path)} tabindex="0"
                    onkeydown={(e) => e.key === "Enter" && open(info.source_path)}>
                  {#each $activeColumns as key (key)}
                    <td title={cellValue(info, key, $vaultPath ?? "")}
                      >{cellValue(info, key, $vaultPath ?? "")}</td
                    >
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

      <footer class="modal-foot">
        <div class="views">
          <span class="views-label">{m.table_views()}</span>
          {#each $savedViews as v (v.id)}
            <span class="saved">
              <button class="btn btn--sm btn--plain" onclick={() => applySavedView(v)}>{v.name}</button>
              <button
                class="op"
                title={m.table_view_delete()}
                aria-label={m.table_view_delete()}
                onclick={() => deleteSavedView(v.id)}><X size={11} /></button
              >
            </span>
          {:else}
            <span class="views-empty">{m.table_view_none()}</span>
          {/each}
          <input
            class="view-name"
            bind:value={viewName}
            placeholder={m.table_view_name_placeholder()}
            onkeydown={(e) => e.key === "Enter" && submitSave()}
          />
          <button class="btn btn--sm" disabled={!viewName.trim()} onclick={submitSave}>
            {m.table_view_save()}
          </button>
        </div>
        <div class="count">
          <!--
            ⚠️ 잘라낸 사실을 **화면에 쓴다.** 조용한 상한은 "전부 봤다"로 읽힌다 —
            MCP가 같은 이유로 `truncated: true`를 낸다.
          -->
          <span>{m.table_showing({ shown: shown.length, total: rows.length })}</span>
          {#if shown.length < rows.length}
            <button class="btn btn--sm" onclick={showMore}>
              {m.table_show_more({ step: RENDER_STEP })}
            </button>
          {/if}
        </div>
      </footer>
    </div>
  </ModalShell>
{/if}

<style>
  .modal {
    display: flex;
    flex-direction: column;
    width: min(1180px, 94vw);
    height: min(78vh, 860px);
    background: var(--surface-panel);
    border: 1px solid var(--border-default);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-overlay);
    color: var(--text-primary);
    overflow: hidden;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px var(--sp-6);
    background: var(--surface-overlay);
    border-bottom: 1px solid var(--border-default);
    font-weight: 600;
    font-size: var(--fs-base);
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    padding: var(--sp-4) var(--sp-6);
    border-bottom: 1px solid var(--border-subtle);
  }

  .spacer {
    flex: 1;
  }

  .search,
  .view-name {
    height: var(--control-h-sm);
    padding: 0 var(--sp-4);
    background: var(--surface-content);
    border: 1px solid var(--border-default);
    border-radius: var(--r-sm);
    color: var(--text-primary);
    font-size: var(--fs-sm);
  }

  .search {
    width: 280px;
  }

  .view-name {
    width: 140px;
  }

  .menu-wrap {
    position: relative;
  }

  /**
   * 컬럼 메뉴.
   *
   * ⚠️ **`thead th` 보다 위여야 한다.** 둘 다 `z-index: 1` 이었는데, 같은 값이면
   * **DOM 순서가 이긴다** — 표가 툴바보다 뒤에 있어서 sticky 헤더가 메뉴를 덮었다.
   * 메뉴는 열리는데 첫 줄들이 헤더 뒤로 사라진다. 에러는 없다.
   *
   * ⚠️ 두 값을 바꿀 때는 같이 본다. 이 카드 안의 국지적 척도이고 `--z-*` 와 무관하다:
   *   1 = sticky 헤더(행 위)
   *   2 = 컬럼 메뉴(헤더 위)
   * `tableStacking.test.ts` 가 순서를 못 박는다.
   */
  .menu {
    position: absolute;
    top: calc(100% + var(--sp-2));
    right: 0;
    z-index: 2;
    min-width: 210px;
    max-height: 320px;
    overflow-y: auto;
    padding: var(--sp-2);
    background: var(--surface-overlay);
    border: 1px solid var(--border-default);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-overlay);
  }

  .menu-head,
  .menu-empty {
    margin: var(--sp-2) var(--sp-3);
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    width: 100%;
    padding: var(--sp-2) var(--sp-3);
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-primary);
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }

  .menu-item:hover {
    background: var(--surface-raised);
  }

  .menu-item .k {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .n {
    color: var(--text-muted);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
  }

  .facets {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
    max-height: 68px;
    overflow-y: auto;
    padding: var(--sp-3) var(--sp-6);
    border-bottom: 1px solid var(--border-subtle);
  }

  .chip {
    padding: var(--sp-1) var(--sp-3);
    border: 1px solid var(--border-default);
    border-radius: var(--r-full);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    cursor: pointer;
  }

  .chip--topic {
    border-style: dashed;
  }

  .chip:hover {
    background: var(--surface-raised);
  }

  .chip.on {
    border-color: var(--accent);
    background: var(--accent-bg-subtle);
    color: var(--text-primary);
  }

  .table-wrap {
    flex: 1;
    overflow: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sm);
  }

  /* sticky 헤더 — 행 위, **컬럼 메뉴 아래**(위 `.menu` 주석 참조). */
  thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 0;
    background: var(--surface-overlay);
    border-bottom: 1px solid var(--border-default);
    text-align: left;
    font-weight: 600;
    white-space: nowrap;
  }

  .th {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-4);
  }

  .sort {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    flex: 1;
    border: 0;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
  }

  /* frontmatter 키는 vault가 정한 이름이라 코드 서체로 — 번역된 라벨과 구분된다. */
  .sort span:not(.builtin) {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: var(--fs-xs);
    color: var(--text-secondary);
  }

  .col-ops {
    display: flex;
    gap: 1px;
    opacity: 0;
  }

  th:hover .col-ops,
  .col-ops:focus-within {
    opacity: 1;
  }

  .op {
    display: inline-flex;
    align-items: center;
    padding: 1px;
    border: 0;
    border-radius: var(--r-xs);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .op:hover:not(:disabled) {
    background: var(--surface-raised);
    color: var(--text-primary);
  }

  .op:disabled {
    opacity: 0.3;
    cursor: default;
  }

  tbody tr {
    cursor: pointer;
    border-bottom: 1px solid var(--border-subtle);
  }

  tbody tr:hover {
    background: var(--surface-raised);
  }

  td {
    max-width: 380px;
    padding: var(--sp-2) var(--sp-4);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
  }

  td:first-child {
    color: var(--text-primary);
  }

  .empty {
    padding: var(--sp-10) var(--sp-6);
    color: var(--text-muted);
    text-align: center;
  }

  .modal-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-4);
    padding: var(--sp-3) var(--sp-6);
    background: var(--surface-overlay);
    border-top: 1px solid var(--border-default);
  }

  .views {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }

  .views-label,
  .views-empty {
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }

  .saved {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--border-default);
    border-radius: var(--r-full);
    padding-right: var(--sp-2);
  }

  .count {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    color: var(--text-muted);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
</style>
