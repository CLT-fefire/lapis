<script lang="ts">
  import FileTree from "./FileTree.svelte";
  import TagPanel from "./TagPanel.svelte";
  import FilterPanel from "./FilterPanel.svelte";
  import {
    vaultPath,
    notes,
    pickAndOpenVault,
    reloadNotes,
    treeLoading,
    indexBuilding,
  } from "$lib/stores/vault";
  import { sidebarTab, showFilesTab, showTagsTab, tagIndex } from "$lib/stores/tags";
  import {
    docKindCounts,
    topicCounts,
    selectedDocKinds,
    selectedTopics,
  } from "$lib/stores/filters";

  function showFiltersTab() {
    sidebarTab.set("filters");
  }

  function vaultDisplayName(path: string): string {
    return path.split("/").filter(Boolean).pop() ?? path;
  }

  /** 배지 폭 방어 — 3자리 이상은 "99+"로 단축 */
  function compactCount(n: number): string {
    return n > 99 ? "99+" : String(n);
  }
</script>

<aside class="sidebar">
  <header class="sidebar-header">
    {#if $vaultPath}
      <div class="vault-name" title={$vaultPath}>{vaultDisplayName($vaultPath)}</div>
      {#if $treeLoading}
        <span class="loading-spinner" title="트리 로드 중"></span>
      {/if}
      <div class="actions">
        <button class="icon-btn" title="새로고침" onclick={reloadNotes}>↻</button>
        <button class="icon-btn" title="다른 vault 열기" onclick={pickAndOpenVault}>📁</button>
      </div>
    {:else}
      <button class="open-btn" onclick={pickAndOpenVault}>Vault 열기…</button>
    {/if}
  </header>

  {#if $indexBuilding}
    <div class="progress-strip" title="인덱스 빌드 중 (백링크/태그/검색)">
      <div class="progress-fill"></div>
    </div>
  {/if}

  {#if $vaultPath}
    <nav class="tabs" aria-label="Sidebar tabs">
      <button
        class="tab"
        class:active={$sidebarTab === "files"}
        onclick={showFilesTab}
      >
        Files
      </button>
      <button
        class="tab"
        class:active={$sidebarTab === "tags"}
        onclick={showTagsTab}
      >
        Tags
        {#if $tagIndex && $tagIndex.sortedTags.length > 0}
          <span class="badge">{compactCount($tagIndex.sortedTags.length)}</span>
        {/if}
      </button>
      <button
        class="tab"
        class:active={$sidebarTab === "filters"}
        onclick={showFiltersTab}
      >
        Filters
        {#if $selectedDocKinds.size + $selectedTopics.size > 0}
          <span class="badge active">{compactCount($selectedDocKinds.size + $selectedTopics.size)}</span>
        {:else if $docKindCounts.size + $topicCounts.size > 0}
          <span class="badge">{compactCount($docKindCounts.size + $topicCounts.size)}</span>
        {/if}
      </button>
    </nav>
  {/if}

  <div class="sidebar-body">
    {#if !$vaultPath}
      <div class="empty">
        <p>vault 폴더를 선택하면<br />.md 파일들이 여기 표시됩니다.</p>
      </div>
    {:else if $sidebarTab === "files"}
      {#if $notes.length > 0}
        <FileTree entries={$notes} />
      {:else}
        <div class="empty">
          <p>이 폴더에 .md 파일이 없습니다.</p>
          <button class="link-btn" onclick={pickAndOpenVault}>다른 vault 선택</button>
        </div>
      {/if}
    {:else if $sidebarTab === "tags"}
      <TagPanel />
    {:else}
      <FilterPanel />
    {/if}
  </div>
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    background: #1e1e1e;
    border-right: 1px solid #333;
    height: 100%;
    overflow: hidden;
    min-width: 220px;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid #333;
    background: #252526;
    min-height: 42px;
  }

  .vault-name {
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-weight: 600;
    font-size: 13px;
    color: #6dd6ff;
  }

  /* 트리 로딩 — 짧음 (~30-100ms). 작은 pulse dot. */
  .loading-spinner {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #6dd6ff;
    animation: pulse-dot 0.9s ease-in-out infinite;
    flex-shrink: 0;
    margin-right: 4px;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 0.3; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.2); }
  }

  /* 인덱스 빌드 — 길음 (~1-3s). 헤더 하단 1px sliding bar. */
  .progress-strip {
    height: 2px;
    background: #1e1e1e;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    width: 35%;
    background: linear-gradient(90deg, transparent, #6dd6ff, transparent);
    animation: slide 1.2s ease-in-out infinite;
  }

  @keyframes slide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(380%); }
  }

  .actions {
    display: flex;
    gap: 4px;
  }

  .icon-btn,
  .open-btn,
  .link-btn {
    background: transparent;
    border: 1px solid #444;
    color: #ddd;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
  }

  .icon-btn {
    width: 26px;
    height: 26px;
    font-size: 13px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-color: transparent;
    background: #2a2a2a;
  }

  .icon-btn:hover {
    border-color: #6dd6ff;
    background: #333;
  }

  .open-btn {
    width: 100%;
    padding: 6px 10px;
    font-size: 13px;
    background: #2a2a2a;
  }

  .open-btn:hover {
    border-color: #6dd6ff;
    background: #333;
  }

  /* 탭 */
  .tabs {
    display: flex;
    background: #252526;
    border-bottom: 1px solid #333;
  }

  .tab {
    flex: 1;
    min-width: 0;
    padding: 8px 6px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: #888;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
    font-family: inherit;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    transition: color 0.1s, border-color 0.1s;
    overflow: hidden;
  }

  .tab:hover {
    color: #ccc;
  }

  .tab.active {
    color: #6dd6ff;
    border-bottom-color: #6dd6ff;
  }

  .badge {
    background: #2d4a5a;
    color: #9adff7;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 9px;
    text-transform: none;
    letter-spacing: normal;
    font-weight: 500;
    flex-shrink: 0;
    line-height: 1.3;
  }

  .badge.active {
    background: #6dd6ff;
    color: #1a1a1a;
    font-weight: 600;
  }

  .sidebar-body {
    flex: 1;
    overflow-y: auto;
  }

  .empty {
    color: #666;
    font-size: 12px;
    text-align: center;
    padding: 30px 16px;
    line-height: 1.6;
  }

  .empty p {
    margin: 0 0 12px 0;
  }

  .link-btn {
    background: transparent;
    border: none;
    color: #6dd6ff;
    text-decoration: underline;
    font-size: 12px;
    padding: 0;
    cursor: pointer;
  }
</style>
