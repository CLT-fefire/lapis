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
    createNewNote,
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
  import {
    claudeMemEnabled,
    openSettings,
    mirrorSyncing,
    mirrorSyncStartedAt,
    markMirrorSyncStart,
    markMirrorSyncEnd,
  } from "$lib/stores/settings";
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
  /** sync 진행 중 경과(초) — tooltip 표시용. 1초마다 갱신. */
  let mirrorSyncElapsedSec = $state(0);
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;

  // 초기 로드 + 이벤트 listen으로 갱신 (claude-mem 활성 시에만)
  $effect(() => {
    if (!$claudeMemEnabled) {
      mirrorStatus = null;
      markMirrorSyncEnd();
      return;
    }
    // sync_now가 schema build 중이면 mirror_sync_status도 동시 schema build 시도 →
    // SQLITE_BUSY. mirror-sync-done 도착하면 어차피 refresh 다시 도니 effect-init은 skip.
    if (!$mirrorSyncing) {
      void refreshMirrorStatus();
    }
    let u1: UnlistenFn | null = null;
    let u2: UnlistenFn | null = null;
    let u3: UnlistenFn | null = null;
    void listen("mirror-sync-start", () => markMirrorSyncStart()).then((u) => (u3 = u));
    void listen("mirror-sync-done", () => {
      markMirrorSyncEnd();
      void refreshMirrorStatus();
    }).then((u) => (u1 = u));
    void listen("mirror-sync-error", () => {
      markMirrorSyncEnd();
      void refreshMirrorStatus();
    }).then((u) => (u2 = u));
    return () => {
      u1?.();
      u2?.();
      u3?.();
    };
  });

  // 경과 초 카운터 — syncing 동안만 동작. mirrorSyncStartedAt이 null이면 정지.
  $effect(() => {
    const startedAt = $mirrorSyncStartedAt;
    if (startedAt === null) {
      mirrorSyncElapsedSec = 0;
      if (elapsedTimer) {
        clearInterval(elapsedTimer);
        elapsedTimer = null;
      }
      return;
    }
    mirrorSyncElapsedSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    elapsedTimer = setInterval(() => {
      mirrorSyncElapsedSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => {
      if (elapsedTimer) {
        clearInterval(elapsedTimer);
        elapsedTimer = null;
      }
    };
  });

  async function refreshMirrorStatus() {
    try {
      mirrorStatus = await mirrorSyncStatus();
    } catch {
      mirrorStatus = null;
    }
  }

  /** blue: sync 진행 중, green: 정상, yellow: 비어있음, red: 실패. syncing이 다른 상태보다 우선. */
  function mirrorColor(s: SyncStatus | null, syncing: boolean): "blue" | "green" | "yellow" | "red" {
    if (syncing) return "blue";
    if (!s) return "red";
    if (s.last_failure) return "red";
    if (s.memory_count === 0) return "yellow";
    return "green";
  }

  function mirrorTooltip(s: SyncStatus | null, syncing: boolean, elapsedSec: number): string {
    if (syncing) {
      const elapsed = elapsedSec > 0 ? ` · 약 ${elapsedSec}s 경과` : "";
      return `Mirror: sync 진행 중…${elapsed}`;
    }
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

  // 빈 vault 첫 진입 가이드용 Welcome 노트 콘텐츠. 사용자가 명시적으로 버튼을 눌렀을 때만 생성.
  const WELCOME_NOTE_CONTENT = `---
title: Welcome
tags: [welcome, getting-started]
---

# Welcome to Lapis

이 노트는 Lapis 사용법을 익히기 위한 샘플입니다. 자유롭게 편집하거나 삭제하세요.

## Wikilink 예제

다른 노트로의 링크는 \`[[노트이름]]\`으로 작성합니다. 별칭도 가능: \`[[Welcome|환영]]\`.
대상 노트가 없으면 회색 점선으로 표시됩니다 (예: [[아직-없는-노트]]).

## 태그

본문에 \`#태그명\` 형식으로 작성하면 자동 수집됩니다. 예: #welcome #intro.
사이드바 **Tags** 탭에서 모든 태그를 확인할 수 있습니다.

## Mermaid 다이어그램

코드 펜스에 \`mermaid\` 언어를 지정하면 미리보기에서 자동 렌더링됩니다.

\`\`\`mermaid
graph LR
  A[노트 작성] --> B[wikilink 연결]
  B --> C[그래프 탐색]
  C --> D[지식 정리]
\`\`\`

## 단축키 모음

| 단축키 | 동작 |
|---|---|
| \`⌘K\` | Command Palette |
| \`⌘P\` | Quick File Open |
| \`⌘⇧F\` | Full-text 검색 |
| \`⌘F\` | 노트 내 검색 |
| \`⌘N\` | 새 노트 |
| \`⌘G\` | Graph View |
| \`⌘S\` | 즉시 저장 |
| \`F2\` | 노트 이름 변경 |
| \`⌘⌫\` | 노트 휴지통으로 |

## 다음 단계

1. \`⌘N\`으로 첫 노트를 만들어보세요
2. 본문에 \`[[Welcome]]\`을 적어 이 노트를 가리키게 한 뒤, 사이드바 하단 **Backlinks**에서 역참조 확인
3. \`⌘G\`로 그래프를 열어 노트 연결을 시각화

자세한 사용 가이드는 [팀 Confluence 페이지](https://github.com/eren0315/lapis)를 참고하세요.
`;

  let welcomeCreating = $state(false);

  async function createWelcomeNote() {
    if (welcomeCreating) return;
    const vault = $vaultPath;
    if (!vault) return;
    welcomeCreating = true;
    try {
      // parentDir에 vault root를 그대로 전달 — create_note Tauri command이 그 안에 파일 생성
      await createNewNote(vault, "Welcome.md", WELCOME_NOTE_CONTENT);
    } catch (e) {
      console.error("[Sidebar] createWelcomeNote 실패", e);
    } finally {
      welcomeCreating = false;
    }
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
        {#if $claudeMemEnabled}
          <button
            class="mirror-dot mirror-{mirrorColor(mirrorStatus, $mirrorSyncing)}"
            class:syncing={$mirrorSyncing}
            title={mirrorTooltip(mirrorStatus, $mirrorSyncing, mirrorSyncElapsedSec)}
            aria-label="메모리 mirror 상태"
            onclick={openMemorySync}
          ></button>
        {/if}
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
          <p class="empty-hint">처음이신가요? 단축키와 wikilink 예제가 담긴 샘플 노트로 시작해보세요.</p>
          <button
            class="welcome-btn"
            onclick={createWelcomeNote}
            disabled={welcomeCreating}
          >
            {welcomeCreating ? "생성 중…" : "Welcome 샘플 만들기"}
          </button>
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

  <footer class="sidebar-foot">
    <button
      class="icon-btn settings-btn"
      title="설정"
      aria-label="설정 열기"
      onclick={openSettings}
    >⚙</button>
  </footer>
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
  .mirror-blue {
    background: #6dd6ff;
  }

  /* sync 진행 중 — 펄스로 활동 중임을 시각화 */
  .mirror-dot.syncing {
    animation: mirror-pulse 1.1s ease-in-out infinite;
  }
  @keyframes mirror-pulse {
    0%, 100% { opacity: 0.5; transform: scale(0.85); }
    50% { opacity: 1; transform: scale(1.15); }
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

  /* 하단 푸터 — 톱니바퀴 등 보조 액션. vault 미선택 상태에서도 노출. */
  .sidebar-foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    padding: 6px 10px;
    border-top: 1px solid #2a2a2a;
    background: #1c1c1c;
    flex-shrink: 0;
  }

  .settings-btn {
    width: 26px;
    height: 26px;
    font-size: 14px;
    color: #999;
  }
  .settings-btn:hover {
    color: #6dd6ff;
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

  .empty .empty-hint {
    color: #888;
    font-size: 11.5px;
    line-height: 1.55;
    margin: -4px 0 14px 0;
  }

  .welcome-btn {
    background: #2d4a5a;
    border: 1px solid #6dd6ff;
    color: #6dd6ff;
    border-radius: 5px;
    padding: 7px 14px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    margin-bottom: 10px;
    display: inline-block;
  }
  .welcome-btn:hover:not(:disabled) {
    background: #3a5d70;
  }
  .welcome-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
