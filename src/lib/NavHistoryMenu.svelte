<script lang="ts">
  import { scale } from "svelte/transition";
  import { menuPop } from "$lib/motion";
  import { navView } from "$lib/stores/navHistory";
  import { goToHistory } from "$lib/stores/vault";
  import { noteDisplayName } from "$lib/notePath";

  interface Props {
    open: boolean;
    onClose: () => void;
  }

  let { open, onClose }: Props = $props();

  // 최근 방문이 위로 오도록 역순. originalIndex(navState 기준)를 함께 보존해 점프에 사용.
  const items = $derived(
    $navView.entries
      .map((path, index) => ({ path, index, current: index === $navView.cursor }))
      .reverse(),
  );

  async function jump(index: number) {
    onClose();
    await goToHistory(index);
  }

  // 외부 클릭 닫기 — 좌클릭만(WKWebView 우클릭 mouseup→click 오인 회피, ContextMenu 패턴).
  function onWindowMouseDown(e: MouseEvent) {
    if (e.button !== 0 || !open) return;
    const t = e.target as HTMLElement | null;
    // 메뉴 내부 또는 토글 버튼(.nav-history-toggle) 클릭은 무시.
    if (t?.closest(".nav-history-menu") || t?.closest(".nav-history-toggle")) return;
    onClose();
  }

  function onWindowKey(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      onClose();
    }
  }
</script>

<svelte:window onmousedown={onWindowMouseDown} onkeydown={onWindowKey} />

{#if open}
  <ul class="nav-history-menu" role="menu" transition:scale={menuPop()}>
    {#each items as item (item.index)}
      <li>
        <button
          role="menuitem"
          class:current={item.current}
          title={item.path}
          onclick={() => jump(item.index)}
        >
          <span class="dot" aria-hidden="true">{item.current ? "●" : ""}</span>
          <span class="label">{noteDisplayName(item.path)}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .nav-history-menu {
    position: absolute;
    /* 방문 기록 버튼(좌상단) 아래에서 자라난다. */
    transform-origin: top left;
    top: calc(100% + var(--sp-2));
    left: 0;
    list-style: none;
    margin: 0;
    padding: var(--sp-2) 0;
    background: var(--surface-overlay);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-md);
    z-index: var(--z-context-menu);
    min-width: 220px;
    max-width: 360px;
    max-height: 60vh;
    overflow-y: auto;
    font-size: var(--fs-base);
  }

  .nav-history-menu li {
    margin: 0;
  }

  .nav-history-menu button {
    width: 100%;
    text-align: left;
    padding: var(--sp-2) var(--sp-3);
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--fs-sm);
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .nav-history-menu button:hover {
    background: var(--surface-sunken);
    color: var(--text-primary);
  }

  .nav-history-menu button.current {
    color: var(--accent);
    font-weight: 600;
  }

  .dot {
    flex-shrink: 0;
    width: 1em;
    text-align: center;
    color: var(--accent);
    font-size: var(--fs-xs);
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
