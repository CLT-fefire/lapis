<script lang="ts">
  import { tick } from "svelte";
  import type { NoteEntry } from "$lib/tauri/notes";
  import {
    selectNote,
    currentNotePath,
    deletePath,
    renamePath,
    movePath,
    autoUpdateLinks,
  } from "$lib/stores/vault";
  import { contextTarget, renameRequest, clearRenameRequest } from "$lib/stores/tree-ui";
  import { treeFilterQuery } from "$lib/stores/treeFilter";
  import Self from "./FileTree.svelte";

  interface Props {
    entries: NoteEntry[];
    depth?: number;
    /** 필터 활성 시 모든 폴더 강제 펼침 — Sidebar가 filter query 입력 중일 때 true 전달 */
    forceExpand?: boolean;
    /** 필터 ↑↓ 키보드 순회로 활성화된 leaf path. row.keyboard-active 강조. */
    activePath?: string | null;
  }

  let { entries, depth = 0, forceExpand = false, activePath = null }: Props = $props();

  let expanded = $state<Record<string, boolean>>({});

  /** 실제 표시상 펼친 여부 — forceExpand 시 무조건 펼침, 아니면 사용자 toggle 결과. */
  function isOpen(path: string): boolean {
    return forceExpand || !!expanded[path];
  }

  /** entry.name에서 query 매치 부분에 <mark> 강조 (HTML safe — entry name은 user file이라 escape) */
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
  /** 인라인 편집 중인 entry path */
  let editingPath = $state<string | null>(null);
  let editingName = $state("");
  let editingInputEl: HTMLInputElement | null = $state(null);

  function toggle(path: string) {
    expanded[path] = !expanded[path];
  }

  function startRename(entry: NoteEntry) {
    editingPath = entry.path;
    editingName = entry.name; // NoteEntry.name은 file/folder stem
    tick().then(() => editingInputEl?.select());
  }

  // ContextMenu에서 rename 요청 도착 시 — 이 트리 안의 entry인지 확인 후 시작
  $effect(() => {
    const requested = $renameRequest;
    if (!requested) return;
    for (const entry of entries) {
      if (entry.path === requested) {
        startRename(entry);
        clearRenameRequest();
        return;
      }
    }
    // 이 트리에 없으면 자식 트리에서 처리됨 (Self 재귀)
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

  // 외부에서 rename 요청 들어오면 시작
  function isEditingThis(path: string): boolean {
    return editingPath === path;
  }

  // 드래그 앤 드롭
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
    // src의 부모가 이미 entry이면 의미 없음 (이동 X)
    const srcParent = src.split("/").slice(0, -1).join("/");
    if (srcParent === entry.path) return;
    await movePath(src, entry.path);
  }
</script>

<ul class="tree" class:nested={depth > 0}>
  {#each entries as entry (entry.path)}
    {#if entry.is_dir}
      <li>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="row-wrap"
          class:drop-target={dropTarget === entry.path}
          oncontextmenu={(e) => openContextMenu(e, entry)}
          ondragover={(e) => onDragOver(e, entry)}
          ondragleave={onDragLeave}
          ondrop={(e) => onDrop(e, entry)}
        >
          {#if isEditingThis(entry.path)}
            <span class="row dir editing">
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
              onclick={() => toggle(entry.path)}
              draggable="true"
              ondragstart={(e) => onDragStart(e, entry)}
            >
              <span class="caret" class:open={isOpen(entry.path)}>▸</span>
              <span class="icon folder">{isOpen(entry.path) ? "📂" : "📁"}</span>
              <!-- entry.name은 file/folder stem(사용자 입력). highlightName이 escape 처리 -->
              <span class="name">{@html highlightName(entry.name)}</span>
            </button>
          {/if}
        </div>
        {#if isOpen(entry.path) && entry.children}
          <Self entries={entry.children} depth={depth + 1} {forceExpand} {activePath} />
        {/if}
      </li>
    {:else}
      <li>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="row-wrap"
          oncontextmenu={(e) => openContextMenu(e, entry)}
        >
          {#if isEditingThis(entry.path)}
            <span class="row note editing">
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
              data-leaf-path={entry.path}
              onclick={() => selectNote(entry.path)}
              draggable="true"
              ondragstart={(e) => onDragStart(e, entry)}
            >
              <span class="caret-spacer"></span>
              <span class="icon file">📝</span>
              <!-- entry.name은 file stem(사용자 입력). highlightName이 escape 처리 -->
              <span class="name">{@html highlightName(entry.name)}</span>
            </button>
          {/if}
        </div>
      </li>
    {/if}
  {/each}
</ul>

<style>
  .tree {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .tree.nested {
    padding-left: 14px;
  }

  li {
    margin: 1px 0;
  }

  .row-wrap {
    position: relative;
  }

  .row-wrap.drop-target {
    background: rgba(109, 214, 255, 0.15);
    outline: 1px dashed #6dd6ff;
    border-radius: 4px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 8px;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    border-radius: 4px;
    font-family: inherit;
    font-size: 13px;
    line-height: 1.4;
    transition: background 0.1s;
  }

  .row.dir {
    color: #e8e8e8;
    font-weight: 600;
  }

  .row.note {
    color: #aaa;
    font-weight: 400;
  }

  .row:hover {
    background: #2f2f2f;
  }

  .row.dir:hover {
    background: #353535;
  }

  .row.note.active {
    background: #2d4a5a;
    color: #ffffff;
    font-weight: 600;
    box-shadow: inset 3px 0 0 #6dd6ff;
  }

  .row.note.active:hover {
    background: #355a6e;
  }

  /* 필터 ↑↓ 키보드로 활성화된 row — 현재 열린 노트(.active)와 시각 구분(노란 톤) */
  .row.note.keyboard-active {
    background: rgba(247, 201, 71, 0.12);
    box-shadow: inset 3px 0 0 #f7c947;
  }

  .row.note.active.keyboard-active {
    /* 두 클래스 동시 — keyboard 강조 + active 글자색 유지. shadow는 keyboard쪽이 이김 */
    background: #3a4a4a;
    box-shadow: inset 3px 0 0 #f7c947;
  }

  .caret {
    display: inline-block;
    font-size: 10px;
    width: 10px;
    flex-shrink: 0;
    transition: transform 0.15s;
    color: #888;
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
    font-size: 13px;
    line-height: 1;
    flex-shrink: 0;
  }

  .icon.folder {
    width: 16px;
  }

  .icon.file {
    width: 16px;
    opacity: 0.65;
    font-size: 11px;
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
    background: #1a1a1a;
    border: 1px solid #6dd6ff;
    color: #fff;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: inherit;
    font-size: 13px;
    min-width: 0;
    outline: none;
  }

  .row.editing {
    background: rgba(109, 214, 255, 0.08);
    border-radius: 4px;
  }

  /* tree filter 매치 강조 — entry name 안의 substring */
  .name :global(mark) {
    background: rgba(255, 200, 0, 0.4);
    color: inherit;
    padding: 0 1px;
    border-radius: 2px;
  }
</style>
