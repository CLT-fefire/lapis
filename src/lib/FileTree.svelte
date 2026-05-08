<script lang="ts">
  import type { NoteEntry } from "$lib/tauri/notes";
  import { selectNote, currentNotePath } from "$lib/stores/vault";
  import Self from "./FileTree.svelte";

  interface Props {
    entries: NoteEntry[];
    depth?: number;
  }

  let { entries, depth = 0 }: Props = $props();

  let expanded = $state<Record<string, boolean>>({});

  function toggle(path: string) {
    expanded[path] = !expanded[path];
  }
</script>

<ul class="tree" class:nested={depth > 0}>
  {#each entries as entry (entry.path)}
    {#if entry.is_dir}
      <li>
        <button class="row dir" onclick={() => toggle(entry.path)}>
          <span class="caret" class:open={expanded[entry.path]}>▸</span>
          <span class="icon folder">{expanded[entry.path] ? "📂" : "📁"}</span>
          <span class="name">{entry.name}</span>
        </button>
        {#if expanded[entry.path] && entry.children}
          <Self entries={entry.children} depth={depth + 1} />
        {/if}
      </li>
    {:else}
      <li>
        <button
          class="row note"
          class:active={$currentNotePath === entry.path}
          onclick={() => selectNote(entry.path)}
        >
          <span class="caret-spacer"></span>
          <span class="icon file">📝</span>
          <span class="name">{entry.name}</span>
        </button>
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

  /* 폴더: 굵은 폰트 + 밝은 색으로 두드러지게 */
  .row.dir {
    color: #e8e8e8;
    font-weight: 600;
  }

  /* 파일: 일반 폰트 + 흐린 색 */
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

  /* 활성 노트: 좌측 강조 바 + 진한 배경 + 굵은 흰 텍스트 */
  .row.note.active {
    background: #2d4a5a;
    color: #ffffff;
    font-weight: 600;
    box-shadow: inset 3px 0 0 #6dd6ff;
  }

  .row.note.active:hover {
    background: #355a6e;
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
</style>
