<script lang="ts">
  import FileTree from "./FileTree.svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { welcomeNote } from "$lib/welcomeDoc";
  import TagPanel from "./TagPanel.svelte";
  import FilterPanel from "./FilterPanel.svelte";
  import FavoritesPanel from "./FavoritesPanel.svelte";
  import {
    vaultPath,
    notes,
    linkIndex,
    pickAndOpenVault,
    reloadNotes,
    treeLoading,
    indexBuilding,
    indexRefreshing,
    createNewNote,
    selectNote,
  } from "$lib/stores/vault";
  import { buildProgress } from "$lib/stores/search";
  import { groupingField, setGroupingField } from "$lib/stores/lens";
  import { groupingCandidates, groupNotesByField } from "$lib/lens";
  import {
    treeFilterQuery,
    clearTreeFilter,
    filterEntries,
    countMatches,
    collectLeafPaths,
  } from "$lib/stores/treeFilter";
  import { tick } from "svelte";
  import { tagIndex } from "$lib/stores/tags";
  import SidebarView from "./SidebarView.svelte";
  import {
    sidebarNav,
  } from "$lib/stores/sidebar";
  import { FileText, Hash, SlidersHorizontal, Star, Settings, ChevronDown } from "@lucide/svelte";
  import PaneMenu, { type PaneMenuItem } from "./PaneMenu.svelte";
  import { revealInFinder } from "$lib/tauri/reveal";
  import { forceReindex } from "$lib/stores/vault";
  import { watcherStatus } from "$lib/stores/watcher";
  import { pinnedNotePaths } from "$lib/stores/pins";
  import {
    docKindCounts,
    topicCounts,
    selectedDocKinds,
    selectedTopics,
  } from "$lib/stores/filters";
  import { openSettings } from "$lib/stores/settings";
  import { toggleSidebar, sidebarCollapsed } from "$lib/stores/layout";

  function vaultDisplayName(path: string): string {
    return path.split("/").filter(Boolean).pop() ?? path;
  }

  // === vault 메뉴 (Discord 서버 헤더 드롭다운) ===
  // 헤더에 상시 노출하던 ↻ 📁 를 여기로 접고, 설정에만 있던 인덱스 재구축도 합류시킨다.
  const vaultMenuItems: PaneMenuItem[] = [
    { id: "reload", label: m.sidebar_menu_refresh(), onSelect: () => void reloadNotes() },
    {
      id: "reveal",
      label: m.sidebar_menu_reveal(),
      onSelect: () => {
        if ($vaultPath) void revealInFinder($vaultPath);
      },
    },
    { id: "open-other", label: m.sidebar_menu_open_other(), onSelect: () => void pickAndOpenVault() },
    {
      id: "reindex",
      label: m.sidebar_menu_reindex(),
      title: m.sidebar_menu_reindex_desc(),
      onSelect: () => void forceReindex(),
    },
    { id: "settings", label: m.sidebar_menu_settings(), onSelect: openSettings },
  ];

  // === 하단 상태 (Discord 유저 패널 자리) ===
  // watcher 점(topbar) · 트리 로딩 스피너(헤더) · 인덱스 진행(별도 strip)으로 **세 곳에
  // 흩어져 있던** 신호를 한 줄로 모은다. 우선순위: 작업 중 > 감시 상태.
  const vaultStatus = $derived.by(() => {
    if ($indexBuilding) return { tone: "busy", text: m.sidebar_status_indexing() };
    if ($indexRefreshing) return { tone: "busy", text: m.sidebar_status_refreshing() };
    if ($treeLoading) return { tone: "busy", text: m.sidebar_status_reading_tree() };
    if ($watcherStatus === "watching") return { tone: "ok", text: m.sidebar_status_watching() };
    if ($watcherStatus === "error") return { tone: "error", text: m.sidebar_status_watch_error() };
    return { tone: "idle", text: m.sidebar_status_idle() };
  });

  const noteCount = $derived($linkIndex ? $linkIndex.byPath.size : 0);

  // Phase A-1 — 필드 렌즈 그룹핑. 폴더 트리는 기본값, 필드 선택 시 값별 합성 그룹으로.
  const allInfos = $derived($linkIndex ? [...$linkIndex.byPath.values()] : []);
  const groupingCandidatesList = $derived(groupingCandidates(allInfos));
  const groupedEntries = $derived(
    $groupingField ? groupNotesByField(allInfos, $groupingField) : [],
  );

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


  let welcomeCreating = $state(false);

  async function createWelcomeNote() {
    if (welcomeCreating) return;
    const vault = $vaultPath;
    if (!vault) return;
    welcomeCreating = true;
    try {
      // parentDir에 vault root를 그대로 전달 — create_note Tauri command이 그 안에 파일 생성
      await createNewNote(vault, "Welcome.md", welcomeNote());
    } catch (e) {
      console.error("[Sidebar] createWelcomeNote 실패", e);
    } finally {
      welcomeCreating = false;
    }
  }
</script>

<aside class="sidebar" data-lapis="sidebar">
  <!-- ⚠️ vault 메뉴는 **상단바로 옮겼다**(3.0 PR-3). vault 는 노트가 아니라 창에 딸린
       것이라 사이드바를 접으면 같이 사라지면 안 된다. -->

  <!-- ⚠️ 인덱스 진행은 **상단바 pill** 이 든다(3.0 PR-3). 무한 슬라이딩 바에서
       `buildProgress` 의 done/total 을 쓰는 실측 진행으로 바뀌었다.
       dim 오버레이(.index-overlay)는 최초 빌드에만 — 아래 그대로 남는다. -->

  <!-- ⚠️ 접혀 있으면 **내용을 안 그린다.** 컴포넌트는 살아 있고(펼침이 즉시 뜬다)
       12,000 노트 트리의 렌더 비용만 안 문다. 예전엔 컴포넌트째로 언마운트했다. -->
  <div class="sidebar-body" class:hidden={$sidebarCollapsed}>
    {#if !$vaultPath}
      <div class="empty">
        <p>{m.sidebar_pick_vault_hint()}</p>
      </div>
    {:else}
      {#if $sidebarNav.activeView === "files"}
        <SidebarView title={m.section_files()}>
          {#snippet children()}
      {#if $notes.length > 0}
        <div class="lens-bar">
          <span class="lens-label">{m.sidebar_lens_label()}</span>
          <select
            class="lens-select"
            value={$groupingField ?? ""}
            onchange={(e) => setGroupingField(e.currentTarget.value || null)}
            title={m.sidebar_lens_title()}
          >
            <option value="">{m.sidebar_lens_folder()}</option>
            {#each groupingCandidatesList as c (c.field)}
              <option value={c.field}>{c.field} · {c.noteCount}</option>
            {/each}
          </select>
        </div>
        {#if $groupingField}
          {#if groupedEntries.length > 0}
            <div class="files-pane">
              <FileTree entries={groupedEntries} disableDnd />
            </div>
          {:else}
            <div class="filter-empty">{m.sidebar_lens_empty()}</div>
          {/if}
        {:else}
          <div class="tree-filter">
            <input
              type="text"
              class="tree-filter-input"
              placeholder={m.sidebar_filter_placeholder()}
              value={$treeFilterQuery}
              oninput={(e) => treeFilterQuery.set(e.currentTarget.value)}
              onkeydown={onTreeFilterKeydown}
              spellcheck="false"
              autocomplete="off"
            />
            {#if treeFilterActive}
              <span class="match-count" title={m.sidebar_filter_count_title()}>{filteredMatchCount}</span>
              <button
                class="filter-clear"
                onclick={clearTreeFilter}
                title={m.sidebar_filter_clear_title()}
                aria-label={m.sidebar_filter_clear_aria()}
              >✕</button>
            {/if}
          </div>
          {#if treeFilterActive && filteredNotes.length === 0}
            <div class="filter-empty">{m.sidebar_filter_empty()}</div>
          {:else}
            <div class="files-pane" bind:this={filesPaneEl}>
              <FileTree
                entries={filteredNotes}
                forceExpand={treeFilterActive}
                activePath={activeFilterPath}
              />
            </div>
          {/if}
        {/if}
      {:else}
        <div class="empty">
          <p>{m.sidebar_folder_empty()}</p>
          <p class="empty-hint">{m.sidebar_first_time_hint()}</p>
          <button
            class="btn btn--primary welcome-btn"
            onclick={createWelcomeNote}
            disabled={welcomeCreating}
          >
            {welcomeCreating ? m.sidebar_welcome_creating() : m.sidebar_welcome_create()}
          </button>
          <button class="link-btn" onclick={pickAndOpenVault}>{m.sidebar_pick_other_vault()}</button>
        </div>
      {/if}
          {/snippet}
        </SidebarView>
      {:else if $sidebarNav.activeView === "tags"}
        <SidebarView title={m.section_tags()} count={$tagIndex?.sortedTags.length ?? 0}>
          {#snippet children()}<TagPanel />{/snippet}
        </SidebarView>
      {:else if $sidebarNav.activeView === "filters"}
        <SidebarView
          title={m.section_filters()}
          count={$selectedDocKinds.size + $selectedTopics.size}
        >
          {#snippet children()}<FilterPanel />{/snippet}
        </SidebarView>
      {:else if $sidebarNav.activeView === "favorites"}
        <SidebarView title={m.section_favorites()} count={$pinnedNotePaths.length}>
          {#snippet children()}<FavoritesPanel />{/snippet}
        </SidebarView>
      {:else}
        <!-- ⚠️ 테이블·위생은 **모달**이다. 레일에서 고르면 그 모달을 열고 뷰는 파일로
             돌려 놓는다 — 사이드바에 빈 화면을 남기지 않기 위해서다. -->
        <SidebarView title={m.section_files()}>
          {#snippet children()}
            <div class="empty"><p>{m.sidebar_pick_vault_hint()}</p></div>
          {/snippet}
        </SidebarView>
      {/if}
    {/if}

    {#if $indexBuilding}
      <!-- dim overlay는 **최초** 빌드($indexBuilding)에만 — 쓸 수 있는 인덱스가 아직 없어
           보여줄 게 없으니 클릭을 막아도 무방. watcher 변경/수동 새로고침 등 재빌드는
           $indexRefreshing으로 분류돼 오버레이 없이 백그라운드 진행(트리·클릭 그대로). -->
      <div class="index-overlay" role="status" aria-live="polite">
        <div class="index-overlay-card">
          <div class="spinner" aria-hidden="true"></div>
          <div class="index-overlay-text">
            <div class="primary">{m.sidebar_index_building()}</div>
            <div class="secondary">
              {#if $buildProgress && $buildProgress.total > 0}
                {m.sidebar_index_fulltext_progress({
            done: $buildProgress.done.toLocaleString(),
            total: $buildProgress.total.toLocaleString(),
          })}
              {:else}
                {m.sidebar_index_building_desc()}
              {/if}
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- ⚠️ 상태 줄은 **상태바로 옮겼다**(3.0 PR-3). 감시 상태와 노트 수는 창에 딸린
       정보라, 사이드바를 접었다고 사라지면 안 된다. -->
</aside>

<style>
  /* 접힘 스트립 — 폭은 `.workspace` grid 가 준다. 여기서는 내용만 감춘다. */
  .sidebar-body.hidden {
    display: none;
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    /* 3계층 중 중간 — 레일(어두움)과 본문(밝음) 사이. 보더 없이 명암차로 분리. */
    background: var(--surface-panel);
    height: 100%;
    overflow: hidden;
    /* 폭 제어는 +page.svelte의 .workspace grid가 담당 (드래그 가능). */
    min-width: 0;
  }

  /* 트리 로딩 표시는 하단 상태 줄(.status-dot.busy)로 통합 — 2026-08-05 PR-10.
     pulse-dot keyframes는 아래 index-overlay에서 계속 쓴다. */

  @keyframes pulse-dot {
    0%, 100% { opacity: 0.3; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.2); }
  }

  /* 인덱스 빌드 — 길음 (~1-3s). 헤더 하단 1px sliding bar. */
  @keyframes slide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(380%); }
  }


  .link-btn {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--text-secondary);
    border-radius: var(--r-sm);
    cursor: pointer;
    font-family: inherit;
  }

  /* 구 가로 탭 CSS(.tabs/.tab/.badge)는 #96 세로 아코디언 개편 때 마크업이 사라졌는데
     스타일만 남아 svelte-check 경고 6건을 내고 있었다 — 2026-08-05 제거. */

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
  /* vault 상태 한 줄 — 점(상태) + 텍스트 + 노트 수. */
  /* vault 헤더 트리거 — 이름 전체가 버튼(Discord 서버 헤더). */
  :global(.vault-trigger) {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    width: 100%;
    padding: var(--sp-3);
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    color: var(--text-primary);
    font-family: inherit;
    cursor: pointer;
    transition: background var(--dur-fast);
  }
  :global(.vault-trigger:hover) {
    background: var(--surface-overlay);
  }

  /* 인덱스 빌드 중 dim overlay — 트리 영역 cover.
     ⚠️ backdrop-filter(blur) 금지: WKWebView에서 backdrop-filter 레이어가 빌드 중 고정돼
     자식 스피너 애니메이션이 멈춘다(메인스레드 idle일 때도). dim은 불투명 배경으로 대체. */
  .index-overlay {
    position: absolute;
    inset: 0;
    background: var(--backdrop);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: var(--sp-10);
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
    padding: var(--sp-5) var(--sp-6);
    box-shadow: var(--shadow-md);
    max-width: calc(100% - var(--sp-6) * 2);
  }

  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid var(--border-default);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
    /* 컴포지터 레이어로 승격 → 인덱스 빌드가 메인 스레드를 점유해도 회전이 멈추지 않음. */
    will-change: transform;
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
    padding: var(--sp-10) var(--sp-6);
    line-height: 1.6;
  }

  .empty p {
    margin: 0 0 var(--sp-5) 0;
  }

  .empty .empty-hint {
    color: var(--text-muted);
    font-size: var(--fs-xs);
    line-height: 1.55;
    margin: calc(var(--sp-2) * -1) 0 var(--sp-5) 0;
  }

  /* .welcome-btn은 app.css .btn 프리미티브(.btn--primary) 사용 + 레이아웃만 로컬 */
  .welcome-btn {
    margin-bottom: var(--sp-5);
  }

  .link-btn {
    background: transparent;
    border: none;
    color: var(--accent-text);
    text-decoration: underline;
    font-size: var(--fs-sm);
    padding: 0;
    cursor: pointer;
  }

  /* 필드 렌즈 그룹핑 바 — Files 탭 상단 (폴더 / 필드값 그룹 전환) */
  .lens-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-5) var(--sp-2) var(--sp-5);
    border-bottom: 1px solid var(--border-subtle);
    background: var(--surface-raised);
  }

  .lens-label {
    color: var(--text-muted);
    font-size: var(--fs-xs);
    letter-spacing: 0.01em;
    flex-shrink: 0;
  }

  .lens-select {
    flex: 1;
    min-width: 0;
    background: var(--surface-sunken);
    border: 1px solid var(--border-default);
    color: var(--text-primary);
    padding: var(--sp-2) var(--sp-3);
    border-radius: var(--r-sm);
    font-family: inherit;
    font-size: var(--fs-sm);
    cursor: pointer;
  }

  .lens-select:focus {
    border-color: var(--accent);
    outline: none;
  }

  /* tree filter — 파일 트리 상단 검색 input */
  .tree-filter {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-5) var(--sp-2) var(--sp-5);
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
    color: var(--danger-text);
  }

  .filter-empty {
    padding: var(--sp-5);
    color: var(--text-muted);
    font-size: var(--fs-sm);
    text-align: center;
  }
</style>
