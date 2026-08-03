<script lang="ts">
  import {
    contextTarget,
    closeContextMenu,
    openNewNote,
    requestRename,
  } from "$lib/stores/tree-ui";
  import { deletePath, createNewFolder } from "$lib/stores/vault";
  import { pinnedNotePaths, togglePin } from "$lib/stores/pins";
  import { revealInFinder } from "$lib/tauri/reveal";

  async function onAction(
    action: "new-note" | "new-folder" | "rename" | "delete" | "copy-path" | "reveal" | "pin",
  ) {
    const target = $contextTarget;
    if (!target) return;
    closeContextMenu();

    const entry = target.entry;
    const parentDir = entry.is_dir ? entry.path : entry.path.split("/").slice(0, -1).join("/");
    const parentLabel = entry.is_dir
      ? entry.name + "/"
      : (entry.path.split("/").slice(-2, -1)[0] ?? "") + "/";

    switch (action) {
      case "new-note":
        openNewNote(parentDir, parentLabel);
        break;
      case "new-folder": {
        const name = window.prompt("새 폴더 이름:");
        if (name && name.trim()) await createNewFolder(parentDir, name.trim());
        break;
      }
      case "rename":
        requestRename(entry.path);
        break;
      case "delete":
        await handleDelete(entry.path, entry.name, entry.is_dir);
        break;
      case "copy-path":
        await copyToClipboard(entry.path);
        break;
      case "reveal":
        await revealInFinder(entry.path);
        break;
      case "pin":
        togglePin(entry.path);
        break;
    }
  }

  async function handleDelete(path: string, name: string, isDir: boolean) {
    const label = isDir ? `폴더 "${name}"` : `노트 "${name}.md"`;
    if (!confirm(`${label}을(를) 휴지통으로 이동할까요?`)) return;
    await deletePath(path);
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.warn("copy failed", e);
    }
  }

  /**
   * 외부 클릭 감지는 mousedown으로 — 우클릭(button=2)의 mouseup이 click으로
   * 인식되는 WKWebView 환경에서 메뉴가 열리자마자 닫히는 버그 회피.
   * 좌클릭(button=0)만 메뉴 닫기 트리거.
   */
  function onWindowMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    if (!$contextTarget) return;
    const menu = (e.target as HTMLElement | null)?.closest(".context-menu");
    if (!menu) closeContextMenu();
  }

  function onWindowKey(e: KeyboardEvent) {
    if (e.key === "Escape") closeContextMenu();
  }
</script>

<svelte:window onmousedown={onWindowMouseDown} onkeydown={onWindowKey} />

{#if $contextTarget}
  {@const target = $contextTarget}
  {@const isDir = target.entry.is_dir}
  <ul
    class="context-menu"
    role="menu"
    style:left="{target.x}px"
    style:top="{target.y}px"
  >
    {#if isDir}
      <li><button onclick={() => onAction("new-note")}>📄 New Note</button></li>
      <li><button onclick={() => onAction("new-folder")}>📁 New Folder</button></li>
      <li class="sep"></li>
    {/if}
    <li><button onclick={() => onAction("rename")}>✏️ Rename</button></li>
    <li><button onclick={() => onAction("delete")} class="danger">🗑 Delete (휴지통)</button></li>
    <li class="sep"></li>
    {#if !isDir}
      <li>
        <button onclick={() => onAction("pin")}>
          {$pinnedNotePaths.includes(target.entry.path) ? "📌 Unpin (즐겨찾기 해제)" : "📌 Pin (즐겨찾기)"}
        </button>
      </li>
    {/if}
    <li><button onclick={() => onAction("copy-path")}>📋 Copy Path</button></li>
    <li><button onclick={() => onAction("reveal")}>📂 Finder에서 보기</button></li>
  </ul>
{/if}

<style>
  .context-menu {
    position: fixed;
    list-style: none;
    margin: 0;
    padding: var(--sp-2) 0;
    background: var(--surface-overlay);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-md);
    z-index: var(--z-context-menu);
    min-width: 180px;
    font-size: var(--fs-base);
  }

  .context-menu li {
    margin: 0;
  }

  .context-menu li.sep {
    height: 1px;
    background: var(--border-default);
    margin: var(--sp-2) 0;
  }

  .context-menu button {
    width: 100%;
    text-align: left;
    padding: var(--sp-3) 14px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--fs-base);
    display: flex;
    align-items: center;
    gap: var(--sp-4);
  }

  .context-menu button:hover {
    background: var(--surface-sunken);
    color: var(--text-primary);
  }

  .context-menu button.danger {
    color: var(--danger);
  }

  .context-menu button.danger:hover {
    background: var(--danger-bg-subtle);
  }
</style>
