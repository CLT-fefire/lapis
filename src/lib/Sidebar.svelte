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
  import { mirrorSyncStatus, type SyncStatus } from "$lib/tauri/mirror";
  import { openMemorySync } from "$lib/stores/memorySync";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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

  // Mirror status indicator (PR2 #11) ────────────────────────────────────────
  let mirrorStatus: SyncStatus | null = $state(null);

  // 초기 로드 + 이벤트 listen으로 갱신
  $effect(() => {
    void refreshMirrorStatus();
    let u1: UnlistenFn | null = null;
    let u2: UnlistenFn | null = null;
    void listen("mirror-sync-done", () => void refreshMirrorStatus()).then((u) => (u1 = u));
    void listen("mirror-sync-error", () => void refreshMirrorStatus()).then((u) => (u2 = u));
    return () => {
      u1?.();
      u2?.();
    };
  });

  async function refreshMirrorStatus() {
    try {
      mirrorStatus = await mirrorSyncStatus();
    } catch {
      mirrorStatus = null;
    }
  }

  /** green: 정상, yellow: 비어있음(sync 안 됨), red: 마지막 sync 실패 / 상태 조회 실패 */
  function mirrorColor(s: SyncStatus | null): "green" | "yellow" | "red" {
    if (!s) return "red";
    if (s.last_failure) return "red";
    if (s.memory_count === 0) return "yellow";
    return "green";
  }

  function mirrorTooltip(s: SyncStatus | null): string {
    if (!s) return "Mirror: 상태 조회 실패 (mirror DB 미초기화)";
    if (s.last_failure) return `Mirror: 마지막 sync 실패 — ${s.last_failure}`;
    if (s.memory_count === 0) return "Mirror: 비어있음. Memory: Sync에서 동기화하세요.";
    return `Mirror: ${s.memory_count.toLocaleString()} memories · 최근 sync ${formatEpoch(s.last_incremental_sync_at)}`;
  }

  function formatEpoch(epoch: number): string {
    if (!epoch) return "—";
    const d = new Date(epoch * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
        <button
          class="mirror-dot mirror-{mirrorColor(mirrorStatus)}"
          title={mirrorTooltip(mirrorStatus)}
          aria-label="메모리 mirror 상태"
          onclick={openMemorySync}
        ></button>
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

    {#if $indexBuilding}
      <!-- 인덱스 빌드 중 dim overlay — 진행 중임을 명확히 + 트리 클릭 race condition 차단 -->
      <div class="index-overlay" role="status" aria-live="polite">
        <div class="index-overlay-card">
          <div class="spinner" aria-hidden="true"></div>
          <div class="index-overlay-text">
            <div class="primary">인덱스 빌드 중…</div>
            <div class="secondary">백링크 · 태그 · 풀텍스트 검색 재구성</div>
          </div>
        </div>
      </div>
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
    /* 폭 제어는 +page.svelte의 .workspace grid가 담당 (드래그 가능). */
    min-width: 0;
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

  /* Mirror status indicator — 점만 노출, 클릭 시 MemorySyncModal 오픈 */
  .mirror-dot {
    width: 10px;
    height: 10px;
    align-self: center;
    border-radius: 50%;
    border: none;
    padding: 0;
    margin: 0 4px 0 0;
    cursor: pointer;
    box-shadow: 0 0 0 1px #1a1a1a;
  }
  .mirror-dot:hover {
    box-shadow: 0 0 0 2px #6dd6ff;
  }
  .mirror-green {
    background: #5ad469;
  }
  .mirror-yellow {
    background: #f7c947;
  }
  .mirror-red {
    background: #f47174;
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
    position: relative;
  }

  /* 인덱스 빌드 중 dim overlay — 트리 영역 cover */
  .index-overlay {
    position: absolute;
    inset: 0;
    background: rgba(20, 20, 20, 0.78);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 40px;
    z-index: 30;
    /* 트리 클릭 차단 (overlay가 포인터 받음) */
  }

  .index-overlay-card {
    display: flex;
    align-items: center;
    gap: 12px;
    background: #232323;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    padding: 14px 18px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    max-width: calc(100% - 32px);
  }

  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid #2a2a2a;
    border-top-color: #6dd6ff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .index-overlay-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .index-overlay-text .primary {
    font-size: 13px;
    font-weight: 600;
    color: #e8e8e8;
  }

  .index-overlay-text .secondary {
    font-size: 11px;
    color: #999;
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
