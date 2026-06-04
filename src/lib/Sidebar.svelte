<script lang="ts">
  import FileTree from "./FileTree.svelte";
  import TagPanel from "./TagPanel.svelte";
  import FilterPanel from "./FilterPanel.svelte";
  import OutlinePanel from "./OutlinePanel.svelte";
  import FavoritesPanel from "./FavoritesPanel.svelte";
  import { outlineHeadings } from "$lib/stores/outline";
  import {
    vaultPath,
    notes,
    pickAndOpenVault,
    reloadNotes,
    treeLoading,
    indexBuilding,
    createNewNote,
    selectNote,
  } from "$lib/stores/vault";
  import {
    treeFilterQuery,
    clearTreeFilter,
    filterEntries,
    countMatches,
    collectLeafPaths,
  } from "$lib/stores/treeFilter";
  import { tick } from "svelte";
  import { sidebarTab, showFilesTab, showOutlineTab, showTagsTab, showFavoritesTab, tagIndex } from "$lib/stores/tags";
  import { pinnedNotePaths } from "$lib/stores/pins";
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
  import { toggleSidebar } from "$lib/stores/layout";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";

  function showFiltersTab() {
    sidebarTab.set("filters");
  }

  function vaultDisplayName(path: string): string {
    return path.split("/").filter(Boolean).pop() ?? path;
  }

  // tree filter — 매 입력 keystroke마다 filterEntries(11924 노트 재귀 walk) + DOM 재렌더
  // 비용이 누적되어 UI 멈춤 발생. `$treeFilterQuery`(store)는 input value 즉시 반영하되,
  // 실제 필터 적용은 `debouncedQuery`(100ms debounce)로 분리.
  let debouncedQuery = $state("");
  let filterDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    const q = $treeFilterQuery;
    if (filterDebounceTimer) clearTimeout(filterDebounceTimer);
    // 빈 입력은 즉시 반영(필터 해제는 빨라야 함)
    if (!q.trim()) {
      debouncedQuery = q;
      return;
    }
    filterDebounceTimer = setTimeout(() => {
      debouncedQuery = q;
    }, 100);
  });

  // FileTree는 필터 활성 시 모든 폴더 강제 펼침(forceExpand). 비어 있으면 원본.
  const filteredNotes = $derived.by(() => {
    if (!import.meta.env.DEV) return filterEntries($notes, debouncedQuery);
    const t0 = performance.now();
    const r = filterEntries($notes, debouncedQuery);
    const dt = performance.now() - t0;
    if (debouncedQuery.trim() && dt > 1) {
      console.debug(
        `[lapis-perf] tree-filter filterEntries q="${debouncedQuery}" ` +
          `notes=${$notes.length} dt=${dt.toFixed(1)}ms`,
      );
    }
    return r;
  });
  const filteredMatchCount = $derived.by(() => {
    if (!debouncedQuery.trim()) return 0;
    if (!import.meta.env.DEV) return countMatches(filteredNotes);
    const t0 = performance.now();
    const n = countMatches(filteredNotes);
    const dt = performance.now() - t0;
    if (dt > 1) {
      console.debug(
        `[lapis-perf] tree-filter countMatches count=${n} dt=${dt.toFixed(1)}ms`,
      );
    }
    return n;
  });
  const treeFilterActive = $derived(!!debouncedQuery.trim());

  // 매칭된 leaf 파일 paths — 트리 표시 순서대로. ↑↓ 키보드 순회용.
  const flatMatchPaths = $derived.by(() => {
    if (!treeFilterActive) return [] as string[];
    if (!import.meta.env.DEV) return collectLeafPaths(filteredNotes);
    const t0 = performance.now();
    const r = collectLeafPaths(filteredNotes);
    const dt = performance.now() - t0;
    if (dt > 1) {
      console.debug(
        `[lapis-perf] tree-filter collectLeafPaths paths=${r.length} dt=${dt.toFixed(1)}ms`,
      );
    }
    return r;
  });
  let activeFilterIndex = $state(0);
  const activeFilterPath = $derived<string | null>(
    flatMatchPaths.length > 0 && activeFilterIndex < flatMatchPaths.length
      ? flatMatchPaths[activeFilterIndex]
      : null,
  );

  // query/필터 결과 변경 시 인덱스 0으로 리셋. 결과 비면 -1로(activeFilterPath null).
  $effect(() => {
    const _ = debouncedQuery;
    activeFilterIndex = 0;
  });

  // activeFilterPath 변경 시 해당 row를 사이드바 안에 스크롤 노출
  let filesPaneEl: HTMLDivElement | null = $state(null);
  $effect(() => {
    const path = activeFilterPath;
    if (!path || !filesPaneEl) return;
    void tick().then(() => {
      if (!filesPaneEl) return;
      const el = filesPaneEl.querySelector<HTMLElement>(
        `[data-leaf-path="${cssEscape(path)}"]`,
      );
      if (el) el.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  });

  function cssEscape(s: string): string {
    // CSS attribute selector value 안 backslash + double quote escape.
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function onTreeFilterKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      clearTreeFilter();
      (e.currentTarget as HTMLInputElement).blur();
      return;
    }
    if (!treeFilterActive || flatMatchPaths.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeFilterIndex = Math.min(flatMatchPaths.length - 1, activeFilterIndex + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeFilterIndex = Math.max(0, activeFilterIndex - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const path = activeFilterPath;
      if (path) void selectNote(path);
    }
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
| \`F2\` | 노트 이름 변경 *(Mac 매직 키보드는 \`Fn+F2\` 또는 \`⌘K\` → "Rename")* |
| \`⌘⌫\` | 노트 휴지통으로 |

## 다음 단계

1. \`⌘N\`으로 첫 노트를 만들어보세요
2. 본문에 \`[[Welcome]]\`을 적어 이 노트를 가리키게 한 뒤, 사이드바 하단 **Backlinks**에서 역참조 확인
3. \`⌘G\`로 그래프를 열어 노트 연결을 시각화

자세한 사용 가이드는 [팀 Confluence 페이지](https://everysing.atlassian.net/wiki/spaces/IMA/pages/4435017752/Lapis)를 참고하세요.
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
        <button class="btn btn--icon btn--sm btn--plain" title="새로고침" onclick={reloadNotes}>↻</button>
        <button class="btn btn--icon btn--sm btn--plain" title="다른 vault 열기" onclick={pickAndOpenVault}>📁</button>
        <button class="btn btn--icon btn--sm btn--plain" title="사이드바 접기 (⌘B)" aria-label="사이드바 접기" onclick={toggleSidebar}>◀</button>
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
        class:active={$sidebarTab === "outline"}
        onclick={showOutlineTab}
      >
        Outline
        {#if $outlineHeadings.length > 0}
          <span class="badge">{compactCount($outlineHeadings.length)}</span>
        {/if}
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
      <button
        class="tab"
        class:active={$sidebarTab === "favorites"}
        onclick={showFavoritesTab}
        title="즐겨찾기 · 최근"
      >
        ⭐
        {#if $pinnedNotePaths.length > 0}
          <span class="badge">{compactCount($pinnedNotePaths.length)}</span>
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
        <div class="tree-filter">
          <input
            type="text"
            class="tree-filter-input"
            placeholder="파일 필터…"
            value={$treeFilterQuery}
            oninput={(e) => treeFilterQuery.set(e.currentTarget.value)}
            onkeydown={onTreeFilterKeydown}
            spellcheck="false"
            autocomplete="off"
          />
          {#if treeFilterActive}
            <span class="match-count" title="매칭된 파일 수">{filteredMatchCount}</span>
            <button
              class="filter-clear"
              onclick={clearTreeFilter}
              title="필터 지우기 (Esc)"
              aria-label="필터 지우기"
            >✕</button>
          {/if}
        </div>
        {#if treeFilterActive && filteredNotes.length === 0}
          <div class="filter-empty">매칭되는 파일이 없습니다</div>
        {:else}
          <div class="files-pane" bind:this={filesPaneEl}>
            <FileTree
              entries={filteredNotes}
              forceExpand={treeFilterActive}
              activePath={activeFilterPath}
            />
          </div>
        {/if}
      {:else}
        <div class="empty">
          <p>이 폴더에 .md 파일이 없습니다.</p>
          <p class="empty-hint">처음이신가요? 단축키와 wikilink 예제가 담긴 샘플 노트로 시작해보세요.</p>
          <button
            class="btn btn--primary welcome-btn"
            onclick={createWelcomeNote}
            disabled={welcomeCreating}
          >
            {welcomeCreating ? "생성 중…" : "Welcome 샘플 만들기"}
          </button>
          <button class="link-btn" onclick={pickAndOpenVault}>다른 vault 선택</button>
        </div>
      {/if}
    {:else if $sidebarTab === "outline"}
      <OutlinePanel />
    {:else if $sidebarTab === "tags"}
      <TagPanel />
    {:else if $sidebarTab === "favorites"}
      <FavoritesPanel />
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
      class="btn btn--icon btn--sm btn--plain settings-btn"
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
    background: var(--surface-base);
    border-right: 1px solid var(--border-default);
    height: 100%;
    overflow: hidden;
    /* 폭 제어는 +page.svelte의 .workspace grid가 담당 (드래그 가능). */
    min-width: 0;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    padding: 10px var(--sp-5);
    border-bottom: 1px solid var(--border-default);
    background: var(--surface-raised);
    min-height: 42px;
  }

  .vault-name {
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-weight: 600;
    font-size: var(--fs-base);
    color: var(--accent);
  }

  /* 트리 로딩 — 짧음 (~30-100ms). 작은 pulse dot. */
  .loading-spinner {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse-dot 0.9s ease-in-out infinite;
    flex-shrink: 0;
    margin-right: var(--sp-2);
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 0.3; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.2); }
  }

  /* 인덱스 빌드 — 길음 (~1-3s). 헤더 하단 1px sliding bar. */
  .progress-strip {
    height: 2px;
    background: var(--surface-base);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    width: 35%;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    animation: slide 1.2s ease-in-out infinite;
  }

  @keyframes slide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(380%); }
  }

  .actions {
    display: flex;
    gap: var(--sp-2);
  }

  .open-btn,
  .link-btn {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--text-secondary);
    border-radius: var(--r-sm);
    cursor: pointer;
    font-family: inherit;
  }

  /* Mirror status indicator — 점만 노출, 클릭 시 MemorySyncModal 오픈 */
  .mirror-dot {
    width: 10px;
    height: 10px;
    align-self: center;
    border-radius: 50%;
    border: none;
    padding: 0;
    margin: 0 var(--sp-2) 0 0;
    cursor: pointer;
    box-shadow: 0 0 0 1px var(--surface-sunken);
  }
  .mirror-dot:hover {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .mirror-green {
    background: var(--success);
  }
  .mirror-yellow {
    background: var(--warning);
  }
  .mirror-red {
    background: var(--danger);
  }
  .mirror-blue {
    background: var(--accent);
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
    padding: var(--sp-3) 10px;
    font-size: var(--fs-base);
    background: var(--surface-overlay);
  }

  .open-btn:hover {
    border-color: var(--accent);
    background: var(--surface-sunken);
  }

  /* 탭 */
  .tabs {
    display: flex;
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border-default);
  }

  .tab {
    flex: 1;
    min-width: 0;
    padding: var(--sp-4) var(--sp-3);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
    font-family: inherit;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-2);
    transition: color var(--dur-fast), border-color var(--dur-fast);
    overflow: hidden;
  }

  .tab:hover {
    color: var(--text-secondary);
  }

  .tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .badge {
    background: var(--accent-bg-subtle);
    color: var(--accent-hover);
    font-size: 10px;
    padding: 1px 5px;
    border-radius: var(--r-lg);
    text-transform: none;
    letter-spacing: normal;
    font-weight: 500;
    flex-shrink: 0;
    line-height: 1.3;
  }

  .badge.active {
    background: var(--accent);
    color: var(--accent-fg);
    font-weight: 600;
  }

  .sidebar-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
    position: relative;
    min-height: 0;
  }

  /* files 탭에서 FileTree를 가상 스크롤하는 컨테이너 — sidebar-body 안에서 남은 영역 채움.
     position:absolute + inset:0 패턴으로 .virtual-container의 height를 명시적으로 부여 →
     OS native wheel/trackpad scroll이 정상 발화 (flex:1만으로는 일부 환경에서 height 0). */
  .files-pane {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }
  .files-pane > :global(.virtual-container) {
    position: absolute;
    inset: 0;
  }

  /* 하단 푸터 — 톱니바퀴 등 보조 액션. vault 미선택 상태에서도 노출. */
  .sidebar-foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--sp-2);
    padding: var(--sp-3) 10px;
    border-top: 1px solid var(--border-subtle);
    background: var(--surface-raised);
    flex-shrink: 0;
  }

  .settings-btn {
    color: var(--text-muted);
  }
  .settings-btn:hover {
    color: var(--accent);
  }

  /* 인덱스 빌드 중 dim overlay — 트리 영역 cover */
  .index-overlay {
    position: absolute;
    inset: 0;
    background: var(--backdrop);
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
    gap: var(--sp-5);
    background: var(--surface-overlay);
    border: 1px solid var(--border-default);
    border-radius: var(--r-lg);
    padding: 14px 18px;
    box-shadow: var(--shadow-md);
    max-width: calc(100% - 32px);
  }

  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid var(--border-default);
    border-top-color: var(--accent);
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
    gap: var(--sp-1);
    min-width: 0;
  }

  .index-overlay-text .primary {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  .index-overlay-text .secondary {
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }

  .empty {
    color: var(--text-muted);
    font-size: var(--fs-sm);
    text-align: center;
    padding: 30px var(--sp-6);
    line-height: 1.6;
  }

  .empty p {
    margin: 0 0 var(--sp-5) 0;
  }

  .empty .empty-hint {
    color: var(--text-muted);
    font-size: 11.5px;
    line-height: 1.55;
    margin: -4px 0 14px 0;
  }

  /* .welcome-btn은 app.css .btn 프리미티브(.btn--primary) 사용 + 레이아웃만 로컬 */
  .welcome-btn {
    margin-bottom: 10px;
  }

  .link-btn {
    background: transparent;
    border: none;
    color: var(--accent);
    text-decoration: underline;
    font-size: var(--fs-sm);
    padding: 0;
    cursor: pointer;
  }

  /* tree filter — 파일 트리 상단 검색 input */
  .tree-filter {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3) 10px var(--sp-2) 10px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--surface-raised);
  }

  .tree-filter-input {
    flex: 1;
    min-width: 0;
    background: var(--surface-sunken);
    border: 1px solid var(--border-default);
    color: var(--text-primary);
    padding: var(--sp-2) var(--sp-4);
    border-radius: var(--r-sm);
    font-family: inherit;
    font-size: var(--fs-sm);
  }

  .tree-filter-input:focus {
    border-color: var(--accent);
  }

  .match-count {
    color: var(--text-muted);
    font-size: var(--fs-xs);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .filter-clear {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--fs-sm);
    padding: 0 var(--sp-2);
    line-height: 1;
    flex-shrink: 0;
  }

  .filter-clear:hover {
    color: var(--danger);
  }

  .filter-empty {
    padding: var(--sp-5);
    color: var(--text-muted);
    font-size: var(--fs-sm);
    text-align: center;
  }
</style>
