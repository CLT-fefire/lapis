<script lang="ts">
  import {
    FileText,
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
  import { m } from "$lib/paraglide/messages.js";
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
    { key: "files", icon: FileText, label: m.section_files() },
    { key: "tags", icon: Hash, label: m.section_tags() },
    { key: "filters", icon: SlidersHorizontal, label: m.section_filters() },
    { key: "favorites", icon: Star, label: m.section_favorites() },
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

<nav class="rail" aria-label={m.rail_aria()}>
  <button
    class="rail-btn"
    aria-label={$sidebarCollapsed ? m.rail_expand() : m.rail_collapse()}
    aria-expanded={!$sidebarCollapsed}
    onclick={toggleSidebar}
  >
    <ToggleIcon size={18} />
    <span class="rail-tip" aria-hidden="true">
      {$sidebarCollapsed ? m.rail_expand() : m.rail_collapse()}
      <kbd>⌘B</kbd>
    </span>
  </button>
  <div class="rail-sep" aria-hidden="true"></div>
  {#each items as it (it.key)}
    {@const Icon = it.icon}
    {@const isOpen = $sidebarNav.sectionOpen[it.key]}
    <button
      class="rail-btn"
      class:active={isOpen}
      aria-label={it.label}
      aria-pressed={isOpen}
      onclick={() => activate(it.key)}
    >
      <Icon size={18} />
      <span class="rail-tip" aria-hidden="true">{it.label}</span>
    </button>
  {/each}
  <div class="rail-spacer"></div>
  <button class="rail-btn" aria-label={m.rail_settings_open()} onclick={openSettings}>
    <Settings size={18} />
    <span class="rail-tip" aria-hidden="true">{m.rail_settings()}</span>
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
    /* 툴팁이 레일 밖(오른쪽)으로 나가야 하므로 clip하지 않는다.
       아이콘이 7개뿐이라 세로 넘침 걱정이 없어 visible로 둘 수 있다. */
    overflow: visible;
  }

  /* Discord 서버 아이콘의 어휘: 평소 **원형**, hover·active에서 squircle로 모프한다. */
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
    border-radius: var(--r-full);
    cursor: pointer;
    flex-shrink: 0;
    transition: color var(--dur-fast), background var(--dur-fast),
      border-radius var(--dur-base) var(--ease-out);
  }

  .rail-btn:hover,
  .rail-btn.active {
    border-radius: var(--r-lg);
  }

  .rail-btn:hover {
    background: var(--surface-panel);
    color: var(--text-secondary);
  }

  .rail-btn.active {
    background: var(--accent-bg-subtle);
    color: var(--accent);
  }

  /* 선택 인디케이터 — Discord처럼 버튼 안이 아니라 **레일 가장자리**에 붙는 pill.
     높이로 상태를 말한다: 평소 0 → hover 20px → active 24px.
     left 계산식은 버튼(40px)이 레일(--rail-w) 중앙에 있다는 전제에서 x=0으로 보낸다. */
  .rail-btn::before {
    content: "";
    position: absolute;
    left: calc((40px - var(--rail-w, 52px)) / 2);
    top: 50%;
    transform: translateY(-50%);
    width: 4px;
    height: 0;
    background: var(--text-primary);
    border-radius: 0 var(--r-full) var(--r-full) 0;
    transition: height var(--dur-base) var(--ease-out);
  }

  .rail-btn:hover::before {
    height: 20px;
  }

  .rail-btn.active::before {
    height: 24px;
  }

  .rail-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  /* Discord식 툴팁 — 아이콘 오른쪽에서 살짝 밀려 나오는 어두운 말풍선.
     CSS transition이라 app.css의 prefers-reduced-motion 전역 규칙이 그대로 적용된다
     (Svelte transition과 달리 motion.ts를 거칠 필요가 없다). */
  .rail-tip {
    position: absolute;
    left: calc(100% + var(--sp-4));
    top: 50%;
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-5);
    background: var(--tooltip-bg);
    color: var(--tooltip-fg);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-md);
    font-size: var(--fs-sm);
    font-weight: 600;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transform: translateY(-50%) translateX(-4px);
    transition: opacity var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
    z-index: var(--z-context-menu);
  }

  /* 말풍선 꼬리 */
  .rail-tip::before {
    content: "";
    position: absolute;
    right: 100%;
    top: 50%;
    transform: translateY(-50%);
    border: 5px solid transparent;
    border-right-color: var(--tooltip-bg);
  }

  .rail-btn:hover .rail-tip,
  .rail-btn:focus-visible .rail-tip {
    opacity: 1;
    transform: translateY(-50%) translateX(0);
  }

  .rail-tip kbd {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: 500;
    opacity: 0.65;
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
