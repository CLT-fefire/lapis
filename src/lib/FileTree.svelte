<script lang="ts">
  import { tick } from "svelte";
  import type { NoteEntry } from "$lib/tauri/notes";
  import {
    selectNote,
    currentNotePath,
    deletePath,
    renamePath,
    movePath,
  } from "$lib/stores/vault";
  import { contextTarget, renameRequest, clearRenameRequest } from "$lib/stores/tree-ui";
  import {
    treeFilterQuery,
    flattenTree,
    type FlatRow,
  } from "$lib/stores/treeFilter";

  /**
   * 사이드바 파일 트리 — 평탄화 + 가상 스크롤(windowing).
   *
   * **2026-05-20 refactor**: 기존 재귀(`<Self>`) 컴포넌트 모델에서 평탄화 + 단일 컴포넌트가
   * 한 번에 렌더하는 모델로 변경. 11000+ 노트에서 매치 많을 때 DOM 비용 큰 폭 단축.
   *
   * **가상화**: 보이는 viewport + 위/아래 buffer(5 row)만 실제 `<button>` 렌더. 나머지는
   * 위/아래 spacer `<div>`로 공간만 차지. row 높이 고정(28px).
   *
   * **expanded state**: 한 컴포넌트에 Map<path, boolean> 집중. 폴더 toggle 시 변경 + flat row
   * 평탄화 자동 재계산.
   *
   * **호환**:
   * - drag/context menu/rename input: 보이는 row 안에서 발생. dragstart 시 path를 박제 →
   *   target row만 보이면 drop 동작
   * - active(.active) / keyboard-active(.keyboard-active) — flat row의 entry.path 비교
   * - `data-leaf-path` attr 그대로 → Sidebar의 scrollIntoView 셀렉터 호환
   */

  interface Props {
    entries: NoteEntry[];
    /** 필터 활성 시 모든 폴더 강제 펼침 — Sidebar가 filter query 입력 중일 때 true 전달 */
    forceExpand?: boolean;
    /** 필터 ↑↓ 키보드 순회로 활성화된 leaf path. row.keyboard-active 강조. */
    activePath?: string | null;
  }

  let { entries, forceExpand = false, activePath = null }: Props = $props();

  // 폴더 펼침 상태 — 본 컴포넌트가 SOT. 컴포넌트 인스턴스가 한 개라 vault 전환해도 reset.
  // `expanded.has(path)`면 사용자가 명시적으로 toggle한 상태 → 그 값이 우선.
  // 없으면 `forceExpand`(필터 활성 시 true) 따름 → 필터 중에도 사용자가 폴더 접기 가능.
  let expanded = $state<Map<string, boolean>>(new Map());

  function isOpen(path: string): boolean {
    if (expanded.has(path)) return expanded.get(path)!;
    return forceExpand;
  }

  function toggle(path: string) {
    const next = new Map(expanded);
    next.set(path, !isOpen(path));
    expanded = next;
  }

  // 평탄화 — entries, expanded, forceExpand 변경 시 재계산. 측정 로그(DEV).
  const flatRows = $derived.by<FlatRow[]>(() => {
    if (!import.meta.env.DEV) return flattenTree(entries, expanded, forceExpand);
    const t0 = performance.now();
    const r = flattenTree(entries, expanded, forceExpand);
    const dt = performance.now() - t0;
    if (dt > 2) {
      console.debug(
        `[lapis-perf] tree-flatten rows=${r.length} forceExpand=${forceExpand} dt=${dt.toFixed(1)}ms`,
      );
    }
    return r;
  });

  // 가상 스크롤 — viewport 측정 + visible range 계산
  const ROW_HEIGHT = 28; // px. row CSS와 일치해야 함
  const BUFFER = 5; // visible 위/아래 추가 렌더 row 수 — 빠른 스크롤 대응

  let containerEl: HTMLDivElement | null = $state(null);
  let containerHeight = $state(600); // 초기값. ResizeObserver로 갱신
  let scrollTop = $state(0);

  // visible range = [first, last) — first/last는 row 인덱스
  const visibleRange = $derived.by(() => {
    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
    const viewportRows = Math.ceil(containerHeight / ROW_HEIGHT);
    const last = Math.min(flatRows.length, first + viewportRows + BUFFER * 2);
    return { first, last };
  });

  const visibleRows = $derived(flatRows.slice(visibleRange.first, visibleRange.last));
  const topPaddingPx = $derived(visibleRange.first * ROW_HEIGHT);
  const bottomPaddingPx = $derived(
    Math.max(0, (flatRows.length - visibleRange.last) * ROW_HEIGHT),
  );

  function onScroll(e: Event) {
    scrollTop = (e.currentTarget as HTMLDivElement).scrollTop;
  }

  // container 크기 변화 추적 (사이드바 폭/높이 변경 시)
  $effect(() => {
    if (!containerEl) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerHeight = entry.contentRect.height;
      }
    });
    ro.observe(containerEl);
    return () => ro.disconnect();
  });

  // activePath(키보드 활성) 변경 시 visible range 안으로 scrollTop 조정.
  //
  // **중요**: viewport 위치/높이는 `containerEl.scrollTop` / `clientHeight`로 DOM 직접
  // 읽기 — Svelte 5 reactive `scrollTop` state를 읽으면 사용자 휠 scroll이 본 effect를
  // 재실행 → activePath가 visible 밖이면 다시 scrollTop을 reset하여 휠 스크롤이 즉시
  // 되돌려짐(필터 ON 측정 사례). DOM 읽기는 non-reactive라 deps는 activePath +
  // flatRows + containerEl만.
  $effect(() => {
    const path = activePath;
    if (!path || !containerEl) return;
    const idx = flatRows.findIndex((r) => r.entry.path === path);
    if (idx < 0) return;
    const rowTop = idx * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    const viewportTop = containerEl.scrollTop;
    const viewportBottom = viewportTop + containerEl.clientHeight;
    if (rowTop < viewportTop) {
      containerEl.scrollTop = rowTop;
    } else if (rowBottom > viewportBottom) {
      containerEl.scrollTop = rowBottom - containerEl.clientHeight;
    }
  });

  // ── rename 인라인 편집 (보이는 row에서만 발생, editingPath는 컴포넌트 SOT) ──
  let editingPath = $state<string | null>(null);
  let editingName = $state("");
  let editingInputEl: HTMLInputElement | null = $state(null);

  function startRename(entry: NoteEntry) {
    editingPath = entry.path;
    editingName = entry.name;
    tick().then(() => editingInputEl?.select());
  }

  // ContextMenu에서 rename 요청 → 본 컴포넌트가 처리
  $effect(() => {
    const requested = $renameRequest;
    if (!requested) return;
    const row = flatRows.find((r) => r.entry.path === requested);
    if (row) {
      startRename(row.entry);
      clearRenameRequest();
    }
  });

  async function commitRename(entry: NoteEntry) {
    if (!editingPath) return;
    const newName = editingName.trim();
    editingPath = null;
    if (!newName || newName === entry.name) return;
    await renamePath(entry.path, newName);
  }

  function cancelRename() {
    editingPath = null;
  }

  function onEditKey(e: KeyboardEvent, entry: NoteEntry) {
    if (e.key === "Enter") {
      e.preventDefault();
      void commitRename(entry);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelRename();
    }
  }

  async function handleDelete(entry: NoteEntry) {
    const label = entry.is_dir ? `폴더 "${entry.name}"` : `노트 "${entry.name}.md"`;
    if (!confirm(`${label}을(를) 휴지통으로 이동할까요?`)) return;
    await deletePath(entry.path);
  }

  function openContextMenu(e: MouseEvent, entry: NoteEntry) {
    e.preventDefault();
    e.stopPropagation();
    contextTarget.set({
      x: e.clientX,
      y: e.clientY,
      entry,
    });
  }

  // ── drag & drop ──
  let dragging = $state<string | null>(null);
  let dropTarget = $state<string | null>(null);

  function onDragStart(e: DragEvent, entry: NoteEntry) {
    if (!e.dataTransfer) return;
    dragging = entry.path;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", entry.path);
  }

  function onDragOver(e: DragEvent, entry: NoteEntry) {
    if (!entry.is_dir) return;
    e.preventDefault();
    if (dragging && dragging !== entry.path) {
      dropTarget = entry.path;
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    }
  }

  function onDragLeave() {
    dropTarget = null;
  }

  async function onDrop(e: DragEvent, entry: NoteEntry) {
    e.preventDefault();
    e.stopPropagation();
    const src = e.dataTransfer?.getData("text/plain");
    dropTarget = null;
    dragging = null;
    if (!src || !entry.is_dir) return;
    if (src === entry.path) return;
    const srcParent = src.split("/").slice(0, -1).join("/");
    if (srcParent === entry.path) return;
    await movePath(src, entry.path);
  }

  // ── 매치 하이라이트 ──
  function highlightName(name: string): string {
    const q = $treeFilterQuery.trim();
    if (!q) return escapeHtml(name);
    const lower = name.toLowerCase();
    const ql = q.toLowerCase();
    const idx = lower.indexOf(ql);
    if (idx < 0) return escapeHtml(name);
    return (
      escapeHtml(name.slice(0, idx)) +
      "<mark>" +
      escapeHtml(name.slice(idx, idx + q.length)) +
      "</mark>" +
      escapeHtml(name.slice(idx + q.length))
    );
  }

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="virtual-container" bind:this={containerEl} onscroll={onScroll}>
  {#if topPaddingPx > 0}
    <div class="spacer" style="height: {topPaddingPx}px"></div>
  {/if}
  {#each visibleRows as row (row.entry.path)}
    {@const entry = row.entry}
    {@const indentPx = 8 + row.depth * 14}
    <div
      class="row-wrap"
      class:drop-target={dropTarget === entry.path}
      oncontextmenu={(e) => openContextMenu(e, entry)}
      ondragover={(e) => onDragOver(e, entry)}
      ondragleave={onDragLeave}
      ondrop={(e) => onDrop(e, entry)}
    >
      {#if entry.is_dir}
        {#if editingPath === entry.path}
          <span class="row dir editing" style="padding-left: {indentPx}px">
            <span class="caret" class:open={isOpen(entry.path)}>▸</span>
            <span class="icon folder">📁</span>
            <input
              bind:this={editingInputEl}
              bind:value={editingName}
              class="rename-input"
              onkeydown={(e) => onEditKey(e, entry)}
              onblur={() => commitRename(entry)}
            />
          </span>
        {:else}
          <button
            class="row dir"
            style="padding-left: {indentPx}px"
            onclick={() => toggle(entry.path)}
            draggable="true"
            ondragstart={(e) => onDragStart(e, entry)}
          >
            <span class="caret" class:open={isOpen(entry.path)}>▸</span>
            <span class="icon folder">{isOpen(entry.path) ? "📂" : "📁"}</span>
            <!-- entry.name은 user input — highlightName이 escape 처리 -->
            <span class="name">{@html highlightName(entry.name)}</span>
          </button>
        {/if}
      {:else if editingPath === entry.path}
        <span class="row note editing" style="padding-left: {indentPx}px">
          <span class="caret-spacer"></span>
          <span class="icon file">📝</span>
          <input
            bind:this={editingInputEl}
            bind:value={editingName}
            class="rename-input"
            onkeydown={(e) => onEditKey(e, entry)}
            onblur={() => commitRename(entry)}
          />
        </span>
      {:else}
        <button
          class="row note"
          class:active={$currentNotePath === entry.path}
          class:keyboard-active={activePath === entry.path}
          style="padding-left: {indentPx}px"
          data-leaf-path={entry.path}
          onclick={() => selectNote(entry.path)}
          draggable="true"
          ondragstart={(e) => onDragStart(e, entry)}
        >
          <span class="caret-spacer"></span>
          <span class="icon file">📝</span>
          <span class="name">{@html highlightName(entry.name)}</span>
        </button>
      {/if}
    </div>
  {/each}
  {#if bottomPaddingPx > 0}
    <div class="spacer" style="height: {bottomPaddingPx}px"></div>
  {/if}
</div>

<style>
  /* 가상 스크롤 컨테이너 — 사이드바 안에서 flex로 크기 부여됨(부모가 결정) */
  /* 부모(.files-pane)가 position:relative + inset:0으로 명시 size 부여 — flex:1 만으론
     일부 환경에서 height 0이 되어 wheel/trackpad scroll이 안 발화. */
  .virtual-container {
    overflow-y: auto;
    overflow-x: hidden;
  }

  .spacer {
    flex-shrink: 0;
  }

  .row-wrap {
    position: relative;
    height: 28px; /* ROW_HEIGHT와 일치 */
    overflow: hidden;
  }

  .row-wrap.drop-target {
    background: var(--accent-bg-subtle);
    outline: 1px dashed var(--accent);
    border-radius: var(--r-sm);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    width: 100%;
    height: 28px;
    padding-right: var(--sp-4);
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    font-family: inherit;
    font-size: var(--fs-base);
    line-height: 1.4;
    transition: background 0.1s;
  }

  .row.dir {
    color: var(--text-primary);
    font-weight: 600;
  }

  .row.note {
    color: var(--text-secondary);
    font-weight: 400;
  }

  .row:hover {
    background: var(--surface-overlay);
  }

  .row.dir:hover {
    background: var(--surface-overlay);
  }

  .row.note.active {
    background: var(--accent-bg-subtle);
    color: var(--text-primary);
    font-weight: 600;
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .row.note.active:hover {
    background: var(--accent-bg-subtle);
  }

  /* 필터 ↑↓ 키보드로 활성화된 row — 현재 열린 노트(.active)와 시각 구분(노란 톤) */
  .row.note.keyboard-active {
    background: var(--warning-bg-subtle);
    box-shadow: inset 3px 0 0 var(--warning);
  }

  .row.note.active.keyboard-active {
    background: var(--warning-bg-subtle);
    box-shadow: inset 3px 0 0 var(--warning);
  }

  .caret {
    display: inline-block;
    font-size: 10px;
    width: 10px;
    flex-shrink: 0;
    transition: transform 0.15s;
    color: var(--text-muted);
  }

  .caret.open {
    transform: rotate(90deg);
  }

  .caret-spacer {
    display: inline-block;
    width: 10px;
    flex-shrink: 0;
  }

  .icon {
    font-size: var(--fs-base);
    line-height: 1;
    flex-shrink: 0;
  }

  .icon.folder {
    width: 16px;
  }

  .icon.file {
    width: 16px;
    opacity: 0.65;
    font-size: var(--fs-xs);
  }

  .name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .rename-input {
    flex: 1;
    background: var(--surface-sunken);
    border: 1px solid var(--accent);
    color: var(--text-primary);
    padding: var(--sp-1) var(--sp-3);
    border-radius: var(--r-xs);
    font-family: inherit;
    font-size: var(--fs-base);
    min-width: 0;
    outline: none;
  }

  .row.editing {
    background: var(--accent-bg-subtle);
    border-radius: var(--r-sm);
  }

  /* tree filter 매치 강조 — entry name 안의 substring */
  .name :global(mark) {
    background: var(--warning-bg-subtle);
    color: inherit;
    padding: 0 1px;
    border-radius: var(--r-xs);
  }
</style>
