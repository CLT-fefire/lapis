<script lang="ts">
  import FileTree from "./FileTree.svelte";
  import { m } from "$lib/paraglide/messages.js";
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
  import SidebarSection from "./SidebarSection.svelte";
  import {
    sidebarNav,
    toggleSection,
    setSectionHeight,
    SECTION_KEYS,
    type SidebarSectionKey,
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
  import { toggleSidebar } from "$lib/stores/layout";

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

  // === 펼친 섹션 리사이즈 ===
  // 펼친 섹션을 위→아래 순서로 모은다. 마지막 펼친 섹션은 잔여 공간을 흡수(height=null·핸들 없음),
  // 그 위 섹션들은 고정 px(미설정이면 균등) + 하단 리사이즈 핸들. (drag = 위 섹션 높이 조절)
  const openKeys = $derived(SECTION_KEYS.filter((k) => $sidebarNav.sectionOpen[k]));
  const lastOpenKey = $derived<SidebarSectionKey | null>(openKeys.at(-1) ?? null);
  function sectionHeight(key: SidebarSectionKey): number | null {
    return key === lastOpenKey ? null : ($sidebarNav.sectionHeights[key] ?? null);
  }
  function sectionResizable(key: SidebarSectionKey): boolean {
    return openKeys.length > 1 && key !== lastOpenKey;
  }

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
| \`⌘S\` | 즉시 저장 |
| \`F2\` | 노트 이름 변경 *(Mac 매직 키보드는 \`Fn+F2\` 또는 \`⌘K\` → "Rename")* |
| \`⌘⌫\` | 노트 휴지통으로 |

## 다음 단계

1. \`⌘N\`으로 첫 노트를 만들어보세요
2. 본문에 \`[[Welcome]]\`을 적어 이 노트를 가리키게 한 뒤, 사이드바 하단 **Backlinks**에서 역참조 확인
3. \`⌘G\`로 그래프를 열어 노트 연결을 시각화
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
      <!-- Discord 서버 헤더 — 이름 전체가 트리거이고 액션은 메뉴 안으로 접는다.
           접기(◀)는 레일에 상시 있으므로 여기서 제거(중복). -->
      <PaneMenu
        items={vaultMenuItems}
        label={m.sidebar_vault_menu()}
        triggerClass="vault-trigger"
        align="left"
      >
        {#snippet trigger()}
          <span class="vault-name" title={$vaultPath}>{vaultDisplayName($vaultPath)}</span>
          <ChevronDown size={14} strokeWidth={2.5} aria-hidden="true" />
        {/snippet}
      </PaneMenu>
    {:else}
      <button class="open-btn" onclick={pickAndOpenVault}>{m.sidebar_open_vault()}</button>
    {/if}
  </header>

  {#if $indexBuilding || $indexRefreshing}
    <!-- 최초 빌드(blocking)·백그라운드 재빌드/증분 모두 이 얇은 strip으로 표시.
         dim 오버레이(.index-overlay)는 최초 빌드($indexBuilding)에만 — 아래 참조. -->
    <div class="progress-strip" title={m.sidebar_indexing_strip()}>
      <div class="progress-fill"></div>
    </div>
  {/if}

  <div class="sidebar-body">
    {#if !$vaultPath}
      <div class="empty">
        <p>{m.sidebar_pick_vault_hint()}</p>
      </div>
    {:else}
      <SidebarSection
        icon={FileText}
        label={m.section_files()}
        open={$sidebarNav.sectionOpen.files}
        onToggle={() => toggleSection("files")}
        height={sectionHeight("files")}
        resizable={sectionResizable("files")}
        onResize={(h) => setSectionHeight("files", h)}
        onResizeReset={() => setSectionHeight("files", null)}
      >
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
      </SidebarSection>

      <SidebarSection
        icon={Hash}
        label={m.section_tags()}
        open={$sidebarNav.sectionOpen.tags}
        count={$tagIndex?.sortedTags.length ?? 0}
        onToggle={() => toggleSection("tags")}
        height={sectionHeight("tags")}
        resizable={sectionResizable("tags")}
        onResize={(h) => setSectionHeight("tags", h)}
        onResizeReset={() => setSectionHeight("tags", null)}
      >
        {#snippet children()}<TagPanel />{/snippet}
      </SidebarSection>

      <SidebarSection
        icon={SlidersHorizontal}
        label={m.section_filters()}
        open={$sidebarNav.sectionOpen.filters}
        count={$selectedDocKinds.size + $selectedTopics.size || $docKindCounts.size + $topicCounts.size}
        onToggle={() => toggleSection("filters")}
        height={sectionHeight("filters")}
        resizable={sectionResizable("filters")}
        onResize={(h) => setSectionHeight("filters", h)}
        onResizeReset={() => setSectionHeight("filters", null)}
      >
        {#snippet children()}<FilterPanel />{/snippet}
      </SidebarSection>

      <SidebarSection
        icon={Star}
        label={m.section_favorites()}
        open={$sidebarNav.sectionOpen.favorites}
        count={$pinnedNotePaths.length}
        onToggle={() => toggleSection("favorites")}
        height={sectionHeight("favorites")}
        resizable={sectionResizable("favorites")}
        onResize={(h) => setSectionHeight("favorites", h)}
        onResizeReset={() => setSectionHeight("favorites", null)}
      >
        {#snippet children()}<FavoritesPanel />{/snippet}
      </SidebarSection>
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

  <footer class="sidebar-foot">
    <!-- Discord 유저 패널 자리 — 상태 전용.
         설정 버튼은 두지 않는다: 여기에 라벨 없는 작은 ⚙를 놓으면 "작은 글리프는 인지가
         어렵다"는 과거 피드백을 되돌리게 된다. 진입 경로는 레일 ⚙(툴팁 있음) ·
         vault 메뉴 m.sidebar_menu_settings() · ⌘K 로 이미 셋이다. -->
    {#if $vaultPath}
      <div class="vault-status" title={$vaultPath}>
        <span
          class="status-dot"
          class:ok={vaultStatus.tone === "ok"}
          class:busy={vaultStatus.tone === "busy"}
          class:error={vaultStatus.tone === "error"}
        ></span>
        <span class="status-text">{vaultStatus.text}</span>
        {#if noteCount > 0}
          <span class="status-count">{noteCount.toLocaleString()}</span>
        {/if}
      </div>
    {/if}
  </footer>
</aside>

<style>
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

  .sidebar-header {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    padding: var(--sp-5);
    /* 사이드바 본체(--surface-panel)보다 밝아 보더 없이 헤더가 도드라진다. */
    background: var(--surface-raised);
    min-height: calc(var(--control-h-lg) + var(--sp-5));
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

  /* 트리 로딩 표시는 하단 상태 줄(.status-dot.busy)로 통합 — 2026-08-05 PR-10.
     pulse-dot keyframes는 아래 index-overlay에서 계속 쓴다. */

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
    /* 컴포지터 레이어로 승격 → 인덱스 빌드가 메인 스레드를 점유해도(WKWebView)
       transform 애니메이션이 별도 스레드에서 계속 돌아 멈추지 않음. */
    will-change: transform;
  }

  @keyframes slide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(380%); }
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

  .open-btn {
    width: 100%;
    padding: var(--sp-3) var(--sp-5);
    font-size: var(--fs-base);
    background: var(--surface-overlay);
  }

  .open-btn:hover {
    border-color: var(--accent);
    background: var(--surface-sunken);
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
  .sidebar-foot {
    display: flex;
    align-items: center;
    padding: var(--sp-2) var(--sp-3);
    border-top: 1px solid var(--border-subtle);
    background: var(--surface-raised);
    flex-shrink: 0;
  }

  /* vault 상태 한 줄 — 점(상태) + 텍스트 + 노트 수. */
  .vault-status {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    width: 100%;
    min-width: 0;
    padding: var(--sp-2) var(--sp-3);
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--r-full);
    background: var(--text-disabled);
    flex-shrink: 0;
    transition: background var(--dur-slow), box-shadow var(--dur-slow);
  }
  .status-dot.ok {
    background: var(--success);
    box-shadow: 0 0 0 3px var(--success-bg-subtle);
  }
  .status-dot.busy {
    background: var(--warning);
    box-shadow: 0 0 0 3px var(--warning-bg-subtle);
  }
  .status-dot.error {
    background: var(--danger);
    box-shadow: 0 0 0 3px var(--danger-bg-subtle);
  }

  .status-text {
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .status-count {
    font-variant-numeric: tabular-nums;
    color: var(--text-disabled);
    flex-shrink: 0;
  }

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
    color: var(--accent);
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
    color: var(--danger);
  }

  .filter-empty {
    padding: var(--sp-5);
    color: var(--text-muted);
    font-size: var(--fs-sm);
    text-align: center;
  }
</style>
