<script lang="ts" module>
  export type PaneMenuItem = {
    /**
     * each 블록 key. **label로 키를 잡으면 안 된다** — 복사 항목 여러 개가 동시에
     * "✓ 복사됨"이 되면 키가 중복돼 Svelte가 죽는다.
     */
    id: string;
    label: string;
    title?: string;
    disabled?: boolean;
    /**
     * 선택해도 메뉴를 닫지 않는다. 복사류처럼 결과가 **레이블 자체로** 표시되는
     * ("🔗 경로 복사" → "✓ 복사됨") 항목에 쓴다 — 닫아버리면 피드백을 못 본다.
     */
    keepOpen?: boolean;
    onSelect: () => void | Promise<void>;
  };
</script>

<script lang="ts">
  /**
   * 페인 툴바(Editor/Preview)의 `⋯` 오버플로 메뉴.
   *
   * 툴바에 액션이 늘어나면 좁은 창에서 제목이 잘리므로, 자주 안 쓰는 액션을 이 메뉴로
   * 접는다. 바깥에 남기는 기준: **빈도가 높거나(글꼴 Aa) 구조적인 것(접기)**.
   *
   * 팝오버 닫기(외부 mousedown + ESC)는 ReadingControls와 같은 패턴 — 우클릭의 mouseup이
   * click으로 인식되는 WKWebView 이슈를 피하려 좌클릭(button 0)만 트리거로 본다.
   */
  import { scale } from "svelte/transition";
  import { menuPop } from "$lib/motion";

  interface Props {
    items: PaneMenuItem[];
    /** 스크린리더용 — "Editor 추가 작업" 등. */
    label: string;
  }

  let { items, label }: Props = $props();

  let open = $state(false);
  /**
   * 외부 클릭 판정 기준. **클래스(`.pane-menu`)로 검사하면 안 된다** — Editor와 Preview에
   * 인스턴스가 하나씩 있어서, 한쪽 `⋯`를 눌러도 다른 쪽이 "내 안의 클릭"으로 오인해
   * 닫히지 않고 팝오버 두 개가 동시에 뜬다. 자기 루트 엘리먼트로만 판정한다.
   */
  let rootEl: HTMLDivElement | undefined = $state();

  async function select(item: PaneMenuItem) {
    if (item.disabled) return;
    if (!item.keepOpen) open = false;
    await item.onSelect();
  }

  function onWindowMouseDown(e: MouseEvent) {
    if (e.button !== 0 || !open) return;
    const t = e.target as Node | null;
    if (t && rootEl?.contains(t)) return;
    open = false;
  }

  function onWindowKey(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      open = false;
    }
  }
</script>

<svelte:window onmousedown={onWindowMouseDown} onkeydown={onWindowKey} />

<div class="pane-menu" bind:this={rootEl}>
  <button
    class="btn btn--icon btn--sm"
    class:active={open}
    title={label}
    aria-label={label}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >⋯</button>

  {#if open}
    <ul class="pane-menu-popover" role="menu" aria-label={label} transition:scale={menuPop()}>
      {#each items as item (item.id)}
        <li role="none">
          <button
            role="menuitem"
            title={item.title}
            disabled={item.disabled}
            onclick={() => select(item)}
          >{item.label}</button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .pane-menu {
    position: relative;
    display: inline-flex;
  }

  .pane-menu-popover {
    position: absolute;
    top: calc(100% + var(--sp-2));
    right: 0;
    /* ⋯ 버튼(우상단)에서 자라나 보이도록 pop의 원점을 맞춘다. */
    transform-origin: top right;
    list-style: none;
    margin: 0;
    padding: var(--sp-2) 0;
    background: var(--surface-overlay);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-md);
    z-index: var(--z-context-menu);
    min-width: 190px;
    white-space: nowrap;
  }

  .pane-menu-popover li {
    margin: 0;
  }

  .pane-menu-popover button {
    width: 100%;
    text-align: left;
    padding: var(--sp-3) 14px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--fs-base);
    display: flex;
    align-items: center;
    gap: var(--sp-4);
  }

  .pane-menu-popover button:hover:not(:disabled) {
    background: var(--surface-sunken);
    color: var(--text-primary);
  }

  .pane-menu-popover button:disabled {
    color: var(--text-muted);
    cursor: default;
  }
</style>
