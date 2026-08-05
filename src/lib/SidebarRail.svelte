<script lang="ts">
  import {
    FileText,
    ListTree,
    Hash,
    SlidersHorizontal,
    Star,
    Settings,
    PanelLeftOpen,
    PanelLeftClose,
    type LucideIcon,
  } from "@lucide/svelte";
  import {
    ensureSectionOpen,
    toggleSection,
    sidebarNav,
    type SidebarSectionKey,
  } from "$lib/stores/sidebar";
  import { expandSidebar, toggleSidebar, sidebarCollapsed } from "$lib/stores/layout";
  import { openSettings } from "$lib/stores/settings";
  import { get } from "svelte/store";

  /**
   * 좌측 아이콘 레일 — **상시 표시**(2026-08-05 PR-3). 접기의 "최소 상태"가 곧 레일이라
   * 레일 자체는 접지 않는다. 사이드바 접힘은 폭 0이 되는 것이고 레일은 자리를 지킨다.
   *
   * 아이콘 클릭 동작은 사이드바 상태에 따라 갈린다:
   *  - 접힘 → 펼치고 해당 섹션 열기(종전 동작 보존)
   *  - 펼침 → 해당 섹션 **토글**(VS Code 액티비티바 관용구)
   * 활성 표시는 "그 섹션이 열려 있는가" — 사이드바가 접혀 있어도 다시 펼쳤을 때의
   * 상태를 미리 알려준다.
   */
  const items: { key: SidebarSectionKey; icon: LucideIcon; label: string }[] = [
    { key: "files", icon: FileText, label: "Files" },
    { key: "outline", icon: ListTree, label: "Outline" },
    { key: "tags", icon: Hash, label: "Tags" },
    { key: "filters", icon: SlidersHorizontal, label: "Filters" },
    { key: "favorites", icon: Star, label: "Favorites" },
  ];

  // {@const}는 블록/컴포넌트의 직계 자식만 허용되므로(<nav> 안에서는 불가) 룬으로 뽑는다.
  const ToggleIcon = $derived($sidebarCollapsed ? PanelLeftOpen : PanelLeftClose);

  function activate(key: SidebarSectionKey) {
    if (get(sidebarCollapsed)) {
      expandSidebar();
      ensureSectionOpen(key);
    } else {
      toggleSection(key);
    }
  }
</script>

<nav class="rail" aria-label="사이드바 레일">
  <button
    class="rail-btn"
    title={$sidebarCollapsed ? "사이드바 펼치기 (⌘B)" : "사이드바 접기 (⌘B)"}
    aria-label={$sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
    aria-expanded={!$sidebarCollapsed}
    onclick={toggleSidebar}
  >
    <ToggleIcon size={18} />
  </button>
  <div class="rail-sep" aria-hidden="true"></div>
  {#each items as it (it.key)}
    {@const Icon = it.icon}
    {@const isOpen = $sidebarNav.sectionOpen[it.key]}
    <button
      class="rail-btn"
      class:active={isOpen}
      title={it.label}
      aria-label={it.label}
      aria-pressed={isOpen}
      onclick={() => activate(it.key)}
    >
      <Icon size={18} />
    </button>
  {/each}
  <div class="rail-spacer"></div>
  <button class="rail-btn" title="설정" aria-label="설정 열기" onclick={openSettings}>
    <Settings size={18} />
  </button>
</nav>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-2);
    height: 100%;
    padding: var(--sp-3) 0;
    /* 3계층 중 가장 어두운 면 — 보더 없이 명암차만으로 사이드바와 분리된다. */
    background: var(--surface-rail);
    overflow: hidden;
  }

  .rail-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    border-radius: var(--r-md);
    cursor: pointer;
    flex-shrink: 0;
    transition: color var(--dur-fast), background var(--dur-fast);
  }

  .rail-btn:hover {
    background: var(--surface-panel);
    color: var(--text-secondary);
  }

  /* 활성 섹션 — 배경을 사이드바 계층까지 올려 "이 아이콘이 옆 패널과 이어져 있다"를
     보이게 하고, 좌측 accent 바로 선택을 표시한다(FileTree의 pill과 같은 어휘). */
  .rail-btn.active {
    background: var(--surface-panel);
    color: var(--text-primary);
  }

  .rail-btn.active::before {
    content: "";
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 60%;
    background: var(--accent);
    border-radius: 0 var(--r-sm) var(--r-sm) 0;
  }

  .rail-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .rail-sep {
    width: 22px;
    height: 1px;
    background: var(--border-default);
    margin: var(--sp-1) 0;
    flex-shrink: 0;
  }

  .rail-spacer {
    flex: 1;
  }
</style>
