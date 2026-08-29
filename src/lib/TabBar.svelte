<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { tick } from "svelte";
  import { slide } from "svelte/transition";
  import { tabChip } from "$lib/motion";
  import { openTabs } from "$lib/stores/tabs";
  import {
    currentNotePath,
    selectNote,
    closeTab,
    moveTab,
    closeOtherTabs,
    closeTabsToRight,
  } from "$lib/stores/vault";
  import { isDirty } from "$lib/stores/editor";
  import { pinnedNotePaths, togglePin } from "$lib/stores/pins";
  import { noteStem } from "$lib/notePath";
  import { revealInFinder } from "$lib/tauri/reveal";

  let barEl: HTMLDivElement | undefined = $state();

  // 드래그 재정렬 상태
  let dragIndex: number | null = $state(null);
  let dragOverIndex: number | null = $state(null);

  // 우클릭 컨텍스트 메뉴 상태
  let ctxMenu: { path: string; x: number; y: number } | null = $state(null);
  // 우클릭한 탭의 오른쪽에 탭이 있는지(오른쪽 닫기 활성화 판단)
  const hasRight = $derived.by(() => {
    const m = ctxMenu;
    if (!m) return false;
    return $openTabs.indexOf(m.path) < $openTabs.length - 1;
  });

  function onDragStart(e: DragEvent, i: number) {
    dragIndex = i;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      // WebKit/WKWebView는 dataTransfer에 데이터가 있어야 드래그를 유효로 보고 drop 허용.
      e.dataTransfer.setData("text/plain", String(i));
    }
  }
  function onDragOver(e: DragEvent, i: number) {
    e.preventDefault(); // drop 허용
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    dragOverIndex = i;
  }
  function onDrop(e: DragEvent, i: number) {
    e.preventDefault(); // 기본 드롭 동작(텍스트 등) 방지
    e.stopPropagation(); // 컨테이너의 "맨 끝으로" 핸들러로 버블 방지
    if (dragIndex !== null && dragIndex !== i) moveTab(dragIndex, i);
    dragIndex = null;
    dragOverIndex = null;
  }
  function onDragEnd() {
    dragIndex = null;
    dragOverIndex = null;
  }

  // 탭 바 빈 영역(마지막 탭 오른쪽)에 드롭 → 맨 끝으로 이동.
  function onBarDragOver(e: DragEvent) {
    e.preventDefault();
  }
  function onBarDrop(e: DragEvent) {
    e.preventDefault();
    if (dragIndex !== null) moveTab(dragIndex, $openTabs.length - 1);
    dragIndex = null;
    dragOverIndex = null;
  }

  function onContextMenu(e: MouseEvent, path: string) {
    e.preventDefault();
    ctxMenu = { path, x: e.clientX, y: e.clientY };
  }
  function closeCtxMenu() {
    ctxMenu = null;
  }
  function onWindowMouseDown(e: MouseEvent) {
    if (e.button !== 0 || !ctxMenu) return;
    if (!(e.target as HTMLElement | null)?.closest(".tab-ctx-menu")) closeCtxMenu();
  }
  function onWindowKey(e: KeyboardEvent) {
    if (e.key === "Escape" && ctxMenu) {
      e.preventDefault();
      closeCtxMenu();
    }
  }

  // 활성 탭이 가로 스크롤 영역 밖이면 보이도록 스크롤.
  // $currentNotePath 변경 → class:active DOM 반영 후 $effect 실행 → 활성 탭 가시화.
  // block:nearest 로 세로(페이지) 점프 방지, inline:nearest 로 가로만 최소 이동.
  $effect(() => {
    void $currentNotePath; // 의존성 추적
    if (!barEl) return;
    const el = barEl.querySelector<HTMLElement>(".tab.active");
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  function onTabClick(path: string) {
    if (path !== $currentNotePath) void selectNote(path, { via: "tab" });
  }

  function onClose(e: MouseEvent, path: string) {
    e.stopPropagation(); // 탭 클릭(활성화)과 분리
    void closeTab(path);
  }

  function onPinToggle(e: MouseEvent, path: string) {
    e.stopPropagation(); // 탭 활성화와 분리
    togglePin(path);
  }

  /**
   * 활성 탭 밑줄의 자리. `w: 0` 이면 안 그린다.
   *
   * ⚠️ `scrollLeft` 를 빼야 한다. 밑줄은 스트립 안에서 같이 흐르는 요소라 스크롤이
   * 이미 반영돼 있고, 여기서 또 빼면 스크롤할 때마다 밑줄이 두 배로 움직인다.
   */
  let underline = $state({ x: 0, w: 0 });

  function measureUnderline() {
    if (!barEl) return;
    const el = barEl.querySelector<HTMLElement>(".tab.active");
    if (!el) {
      underline = { x: 0, w: 0 };
      return;
    }
    underline = { x: el.offsetLeft, w: el.offsetWidth };
  }

  /**
   * 탭 목록·활성 탭·dirty 표시가 바뀌면 다시 잰다.
   *
   * ⚠️ `tick()` 뒤에 재야 한다. 이 effect 가 도는 시점에는 새 탭이 아직 DOM 에 없어서
   * `offsetLeft` 가 옛 자리를 낸다 — 밑줄이 **한 박자 늦게** 따라온다.
   */
  $effect(() => {
    void $openTabs;
    void $currentNotePath;
    void $isDirty;
    void tick().then(measureUnderline);
  });

  /** 창 크기·스트립 스크롤이 바뀌어도 자리는 유지돼야 한다. */
  $effect(() => {
    if (!barEl) return;
    const ro = new ResizeObserver(() => measureUnderline());
    ro.observe(barEl);
    return () => ro.disconnect();
  });
</script>

{#if $openTabs.length > 0}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="tab-bar"
    data-lapis="tabs"
    role="tablist"
    tabindex="-1"
    bind:this={barEl}
    ondragover={onBarDragOver}
    ondrop={onBarDrop}
  >
    <!--
      ⚠️ 밑줄은 **탭마다 하나씩이 아니라 전체에 하나**다. 탭마다 `box-shadow` 로 그리면
      전환이 "꺼지고 켜진다"가 되는데, 모션 명세(A3)는 밑줄이 **미끄러진다**고 정한다 —
      본문은 즉시 바뀌고 인상만 밑줄이 만든다는 설계다.

      ⚠️ 자리는 측정해서 잡는다. 탭이 드래그로 재정렬되고 가로로 스크롤되므로 CSS 만으로는
      활성 탭의 x 를 알 수 없다. 측정에 실패하면 `width: 0` 이라 **아무것도 안 그린다** —
      틀린 자리에 줄이 남는 것보다 낫다.
    -->
    <span
      class="underline"
      aria-hidden="true"
      style="transform: translateX({underline.x}px); width: {underline.w}px"
    ></span>

    {#each $openTabs as path, i (path)}
      <div
        class="tab"
        class:active={path === $currentNotePath}
        class:pinned={$pinnedNotePaths.includes(path)}
        class:drag-over-before={dragOverIndex === i && dragIndex !== null && dragIndex > i}
        class:drag-over-after={dragOverIndex === i && dragIndex !== null && dragIndex < i}
        class:dragging={dragIndex === i}
        transition:slide={tabChip()}
        role="tab"
        tabindex="0"
        aria-selected={path === $currentNotePath}
        title={path}
        draggable="true"
        ondragstart={(e) => onDragStart(e, i)}
        ondragover={(e) => onDragOver(e, i)}
        ondrop={(e) => onDrop(e, i)}
        ondragend={onDragEnd}
        oncontextmenu={(e) => onContextMenu(e, path)}
        onclick={() => onTabClick(path)}
        onkeydown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onTabClick(path);
          }
        }}
      >
        <button
          class="pin-icon"
          title={$pinnedNotePaths.includes(path) ? m.tab_pin_remove() : m.tab_pin_add()}
          aria-label={m.tab_pin_aria()}
          aria-pressed={$pinnedNotePaths.includes(path)}
          onclick={(e) => onPinToggle(e, path)}
        >{$pinnedNotePaths.includes(path) ? "★" : "☆"}</button>
        {#if path === $currentNotePath && $isDirty}
          <span class="dirty" aria-label={m.tab_dirty_aria()}>●</span>
        {/if}
        <span class="label">{noteStem(path)}</span>
        <button
          class="btn btn--icon btn--sm btn--plain close"
          title={m.tab_close_title()}
          aria-label={m.tab_close_aria()}
          onclick={(e) => onClose(e, path)}
        >✕</button>
      </div>
    {/each}
  </div>
{/if}

<svelte:window onmousedown={onWindowMouseDown} onkeydown={onWindowKey} />

{#if ctxMenu}
  {@const menu = ctxMenu}
  <ul class="tab-ctx-menu" role="menu" style:left="{menu.x}px" style:top="{menu.y}px">
    <li>
      <button role="menuitem" onclick={() => { const p = menu.path; closeCtxMenu(); void closeTab(p); }}>
        {m.tab_close()}
      </button>
    </li>
    <li>
      <button
        role="menuitem"
        disabled={$openTabs.length <= 1}
        onclick={() => { const p = menu.path; closeCtxMenu(); void closeOtherTabs(p); }}
      >{m.tab_close_others()}</button>
    </li>
    <li>
      <button
        role="menuitem"
        disabled={!hasRight}
        onclick={() => { const p = menu.path; closeCtxMenu(); void closeTabsToRight(p); }}
      >{m.tab_close_right()}</button>
    </li>
    <li class="sep"></li>
    <li>
      <!-- path를 먼저 캡처 — closeCtxMenu()가 ctxMenu=null로 만들면 {@const menu}가
           재평가돼 menu.path가 undefined가 된다 (#90 회귀 이력). -->
      <button
        role="menuitem"
        onclick={() => { const p = menu.path; closeCtxMenu(); void revealInFinder(p); }}
      >{m.tab_reveal()}</button>
    </li>
  </ul>
{/if}

<style>
  /* ⚠️ 폴더형 칩에서 **밑줄형**으로(3.0). 칩은 활성 탭이 본문 면으로 갈아타면서
     아래와 이어지는 효과를 노렸는데, 3.0 은 면끼리 명암차가 작아 그 이음매가 안 읽힌다.
     밑줄은 면에 기대지 않는다. */
  .tab-bar {
    display: flex;
    align-items: stretch;
    gap: var(--sp-1);
    height: var(--tabstrip-h);
    padding: 0 var(--sp-2);
    background: var(--surface-tabstrip);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
    /* 밑줄이 `position: absolute` 로 이 안에 산다. */
    position: relative;
  }

  /**
   * 활성 탭 밑줄 — 자리를 **transform 으로** 옮긴다.
   *
   * ⚠️ `left` 를 애니메이션하면 매 프레임 레이아웃이 다시 돈다. `transform` 은 합성
   * 단계에서 끝나므로 본문 렌더를 기다리지 않는다 — 모션 명세(A3)가 "본문은 즉시 바꾸고
   * 밑줄만 움직인다"고 한 이유다.
   *
   * ⚠️ `width` 는 transform 이 아니라 어쩔 수 없이 레이아웃 속성이다. 탭 폭이 제각각이라
   * 대안이 없고, 요소 하나뿐이라 비용이 작다.
   */
  .underline {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 2px;
    background: var(--accent);
    pointer-events: none;
    transition:
      transform 180ms var(--ease-panel),
      width 180ms var(--ease-panel);
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    max-width: 200px;
    padding: 0 var(--sp-2) 0 var(--sp-3);
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: var(--fs-sm);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition:
      background var(--dur-1) var(--ease-standard),
      color var(--dur-1) var(--ease-standard),
      box-shadow var(--dur-3) var(--ease-standard);
  }

  .tab:hover {
    background: var(--surface-hover);
    color: var(--text-secondary);
  }

  /* 밑줄은 공용 `.underline` 이 그린다 — 여기서 또 그리면 두 줄이 된다. */
  .tab.active {
    color: var(--text-primary);
    font-weight: 600;
  }

  /* 드래그 중인 탭은 흐리게, 드롭 대상은 좌측 보더로 삽입 위치 표시 */
  .tab.dragging {
    opacity: 0.4;
  }

  /* 드롭 가이드 — 이동 방향에 맞춰: 왼쪽으로 옮기면 대상 탭 앞(좌), 오른쪽이면 뒤(우) */
  .tab.drag-over-before {
    box-shadow: inset 2px 0 0 0 var(--accent);
  }

  .tab.drag-over-after {
    box-shadow: inset -2px 0 0 0 var(--accent);
  }

  .tab .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab .dirty {
    flex-shrink: 0;
    color: var(--accent-text);
    font-size: var(--fs-xs);
  }

  /* 핀 아이콘 — 미핀은 평소 숨김, 탭 hover 시 ☆ 노출 / 핀되면 ★ 항상 표시. */
  .pin-icon {
    flex-shrink: 0;
    padding: 0;
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: var(--fs-xs);
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    pointer-events: none; /* 숨김 상태에선 클릭 불가 — 투명 버튼 오클릭 방지 */
    transition: opacity var(--dur-fast);
  }

  .tab:hover .pin-icon {
    opacity: 0.55;
    pointer-events: auto;
  }

  .pin-icon:hover {
    opacity: 1;
  }

  .tab.pinned .pin-icon {
    opacity: 1;
    pointer-events: auto;
    color: var(--accent-text);
  }

  .tab .close {
    flex-shrink: 0;
    font-size: var(--fs-xs);
    opacity: 0.6;
  }

  .tab .close:hover {
    opacity: 1;
  }

  /* 탭 우클릭 컨텍스트 메뉴 (ContextMenu 패턴 차용) */
  .tab-ctx-menu {
    position: fixed;
    list-style: none;
    margin: 0;
    padding: var(--sp-2) 0;
    background: var(--surface-overlay);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-md);
    z-index: var(--z-context-menu);
    min-width: 160px;
    font-size: var(--fs-base);
  }

  .tab-ctx-menu li {
    margin: 0;
  }

  /* 탭 닫기 그룹과 Finder 액션 구분 */
  .tab-ctx-menu li.sep {
    height: 1px;
    background: var(--border-default);
    margin: var(--sp-2) 0;
  }

  .tab-ctx-menu button {
    width: 100%;
    text-align: left;
    padding: var(--sp-3) 14px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--fs-base);
  }

  .tab-ctx-menu button:hover:not(:disabled) {
    background: var(--surface-sunken);
    color: var(--text-primary);
  }

  .tab-ctx-menu button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
