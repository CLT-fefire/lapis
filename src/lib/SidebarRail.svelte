<script lang="ts">
  import {
    FileText,
    Hash,
    SlidersHorizontal,
    Star,
    Settings,
    Table,
    Stethoscope,
    type LucideIcon,
  } from "@lucide/svelte";
  import { showView, sidebarNav, type SidebarViewKey } from "$lib/stores/sidebar";
  import { expandSidebar, collapseSidebar, sidebarCollapsed } from "$lib/stores/layout";
  import { openTableView } from "$lib/stores/tableView";
  import { openBrokenLinks } from "$lib/stores/brokenLinks";
  import { openSettings } from "$lib/stores/settings";
  import { m } from "$lib/paraglide/messages.js";
  import { get } from "svelte/store";

  /**
   * 좌측 아이콘 레일 — **뷰를 고른다**(3.0). 상시 표시이고 레일 자체는 접지 않는다.
   *
   * ## ⚠️ 토글에서 선택으로
   *
   * v2.0.0 주석은 이미 "VS Code 액티비티바 관용구"라고 적고 있었는데, 실제 동작은
   * **섹션 토글**이었다(여러 개 동시 펼침). 3.0 은 적혀 있던 대로 만든다:
   *
   *  - 다른 아이콘 → 그 뷰로 **전환**
   *  - 활성 아이콘 다시 → **접기**
   *
   * 그래서 맨 위 접기 버튼이 사라진다 — 재클릭이 그 일을 한다. ⌘B 는 그대로다.
   */
  const items: { key: SidebarViewKey; icon: LucideIcon; label: string }[] = [
    { key: "files", icon: FileText, label: m.section_files() },
    { key: "tags", icon: Hash, label: m.section_tags() },
    { key: "filters", icon: SlidersHorizontal, label: m.section_filters() },
    { key: "favorites", icon: Star, label: m.section_favorites() },
    { key: "table", icon: Table, label: m.cmd_table_view() },
    { key: "hygiene", icon: Stethoscope, label: m.hygiene_title() },
  ];

  /**
   * ⚠️ 테이블과 위생은 **모달**이라 사이드바 뷰가 아니다. 레일에 두는 이유는 그 둘이
   * vault 를 훑는 같은 부류이기 때문이고, 누르면 모달을 연다 — 사이드바는 건드리지
   * 않는다. 여기서 `showView` 를 부르면 **빈 사이드바**가 남는다.
   */
  const MODAL_VIEWS: Partial<Record<SidebarViewKey, () => void>> = {
    table: openTableView,
    hygiene: () => openBrokenLinks(),
  };

  function activate(key: SidebarViewKey) {
    const asModal = MODAL_VIEWS[key];
    if (asModal) return asModal();
    if (get(sidebarCollapsed)) {
      expandSidebar();
      showView(key);
      return;
    }
    // 활성 뷰를 다시 누르면 접는다 — 액티비티 바 관용구.
    if (get(sidebarNav).activeView === key) collapseSidebar();
    else showView(key);
  }
</script>

<nav class="rail" data-lapis="rail" aria-label={m.rail_aria()}>
  <!-- ⚠️ 접기 버튼이 없다 — **활성 아이콘 재클릭**이 그 일을 한다(3.0). ⌘B 는 그대로다. -->
  {#each items as it (it.key)}
    {@const Icon = it.icon}
    {@const isOpen = !$sidebarCollapsed && $sidebarNav.activeView === it.key}
    <button
      class="rail-btn"
      class:active={isOpen}
      aria-label={it.label}
      aria-pressed={isOpen}
      onclick={() => activate(it.key)}
    >
      <Icon size={18} />
      <!-- ⚠️ 접힘 상태에서만 단축키를 같이 낸다. 펼침 상태에서는 뷰 제목이 이미 보여서 -->
      <!--    툴팁이 같은 말을 두 번 하게 된다. -->
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
    color: var(--accent-text);
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

  /**
   * 툴팁 — 아이콘 오른쪽에서 밀려 나오는 어두운 말풍선.
   *
   * CSS transition 이라 `app.css` 의 reduced-motion 규칙이 그대로 적용된다
   * (Svelte transition 과 달리 `motion.ts` 를 거칠 필요가 없다).
   *
   * ⚠️ **등장에만 250ms 지연을 준다**(hover-intent). 없으면 레일을 스쳐 지나가는 것만으로
   * 말풍선이 여섯 개 연달아 튄다 — 아무것도 읽을 시간이 없는데 화면만 시끄럽다.
   *
   * ⚠️ **퇴장에는 지연을 주지 않는다.** 여기 base 규칙이 곧 퇴장이라, 지연을 base 에
   * 쓰면 마우스가 떠난 뒤 250ms 동안 말풍선이 남는다.
   */
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
    transform: translateY(-50%) translateX(-6px);
    transition:
      opacity var(--dur-2) var(--ease-out),
      transform var(--dur-2) var(--ease-out);
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
    transition:
      opacity var(--dur-2) var(--ease-out) 250ms,
      transform var(--dur-2) var(--ease-out) 250ms;
  }

  /* ⚠️ 키보드 포커스에는 지연을 두지 않는다. 스쳐 지나가는 일이 없고, 기다림이 곧
     "안 뜬다"로 읽힌다. */
  .rail-btn:focus-visible .rail-tip {
    transition:
      opacity var(--dur-2) var(--ease-out),
      transform var(--dur-2) var(--ease-out);
  }

  .rail-spacer {
    flex: 1;
  }
</style>
