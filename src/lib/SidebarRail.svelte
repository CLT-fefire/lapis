<script lang="ts">
  import {
    FileText,
    ListTree,
    Hash,
    SlidersHorizontal,
    Star,
    Settings,
    PanelLeftOpen,
    type LucideIcon,
  } from "@lucide/svelte";
  import { ensureSectionOpen, type SidebarSectionKey } from "$lib/stores/sidebar";
  import { expandSidebar, toggleSidebar } from "$lib/stores/layout";
  import { openSettings } from "$lib/stores/settings";

  /**
   * 사이드바 접힘(아이콘 레일) 모드. 아이콘 클릭 = 사이드바 펼침 + 해당 섹션 펼침.
   * 펼친 아코디언과 같은 섹션 집합 — 레이블은 tooltip(title)/aria-label로.
   */
  const items: { key: SidebarSectionKey; icon: LucideIcon; label: string }[] = [
    { key: "files", icon: FileText, label: "Files" },
    { key: "outline", icon: ListTree, label: "Outline" },
    { key: "tags", icon: Hash, label: "Tags" },
    { key: "filters", icon: SlidersHorizontal, label: "Filters" },
    { key: "favorites", icon: Star, label: "Favorites" },
  ];

  function open(key: SidebarSectionKey) {
    expandSidebar();
    ensureSectionOpen(key);
  }
</script>

<nav class="rail" aria-label="사이드바 (접힘)">
  <button
    class="rail-btn"
    title="사이드바 펼치기 (⌘B)"
    aria-label="사이드바 펼치기"
    onclick={toggleSidebar}
  >
    <PanelLeftOpen size={18} />
  </button>
  <div class="rail-sep" aria-hidden="true"></div>
  {#each items as it (it.key)}
    {@const Icon = it.icon}
    <button class="rail-btn" title={it.label} aria-label={it.label} onclick={() => open(it.key)}>
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
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    border-radius: var(--r-sm);
    cursor: pointer;
    flex-shrink: 0;
    transition: color var(--dur-fast), background var(--dur-fast);
  }

  .rail-btn:hover {
    background: var(--surface-sunken);
    color: var(--text-secondary);
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
