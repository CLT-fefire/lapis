<script lang="ts">
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
    if (path !== $currentNotePath) void selectNote(path);
  }

  function onClose(e: MouseEvent, path: string) {
    e.stopPropagation(); // 탭 클릭(활성화)과 분리
    void closeTab(path);
  }

  function onPinToggle(e: MouseEvent, path: string) {
    e.stopPropagation(); // 탭 활성화와 분리
    togglePin(path);
  }
</script>

{#if $openTabs.length > 0}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="tab-bar"
    role="tablist"
    tabindex="-1"
    bind:this={barEl}
    ondragover={onBarDragOver}
    ondrop={onBarDrop}
  >
    {#each $openTabs as path, i (path)}
      <div
        class="tab"
        class:active={path === $currentNotePath}
        class:pinned={$pinnedNotePaths.includes(path)}
        class:drag-over={dragOverIndex === i && dragIndex !== i}
        class:dragging={dragIndex === i}
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
          title={$pinnedNotePaths.includes(path) ? "즐겨찾기 해제" : "즐겨찾기에 추가"}
          aria-label="즐겨찾기 토글"
          aria-pressed={$pinnedNotePaths.includes(path)}
          onclick={(e) => onPinToggle(e, path)}
        >{$pinnedNotePaths.includes(path) ? "★" : "☆"}</button>
        {#if path === $currentNotePath && $isDirty}
          <span class="dirty" aria-label="저장되지 않음">●</span>
        {/if}
        <span class="label">{noteStem(path)}</span>
        <button
          class="btn btn--icon btn--sm btn--plain close"
          title="탭 닫기 (⌘W)"
          aria-label="탭 닫기"
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
      <button role="menuitem" onclick={() => { closeCtxMenu(); void closeTab(menu.path); }}>
        탭 닫기
      </button>
    </li>
    <li>
      <button
        role="menuitem"
        disabled={$openTabs.length <= 1}
        onclick={() => { closeCtxMenu(); void closeOtherTabs(menu.path); }}
      >다른 탭 닫기</button>
    </li>
    <li>
      <button
        role="menuitem"
        disabled={!hasRight}
        onclick={() => { closeCtxMenu(); void closeTabsToRight(menu.path); }}
      >오른쪽 탭 닫기</button>
    </li>
  </ul>
{/if}

<style>
  .tab-bar {
    display: flex;
    align-items: stretch;
    gap: var(--sp-1);
    padding: var(--sp-1) var(--sp-2) 0;
    background: var(--surface-base);
    border-bottom: 1px solid var(--border-default);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    max-width: 200px;
    padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-3);
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    border-bottom: none;
    border-radius: var(--r-sm) var(--r-sm) 0 0;
    color: var(--text-secondary);
    font-size: var(--fs-sm);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .tab:hover {
    background: var(--surface-overlay);
    color: var(--text-primary);
  }

  .tab.active {
    background: var(--surface-base);
    color: var(--text-primary);
    border-color: var(--border-strong);
  }

  /* 드래그 중인 탭은 흐리게, 드롭 대상은 좌측 보더로 삽입 위치 표시 */
  .tab.dragging {
    opacity: 0.4;
  }

  .tab.drag-over {
    box-shadow: inset 2px 0 0 0 var(--accent);
  }

  .tab .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab .dirty {
    flex-shrink: 0;
    color: var(--accent);
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
    color: var(--accent);
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
