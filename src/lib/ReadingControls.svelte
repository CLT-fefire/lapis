<script lang="ts">
  import {
    readingFontSize,
    increaseFontSize,
    decreaseFontSize,
    resetFontSize,
    READING_FONT_MIN,
    READING_FONT_MAX,
    READING_FONT_DEFAULT,
  } from "$lib/stores/reading";

  let open = $state(false);

  function onWindowMouseDown(e: MouseEvent) {
    if (e.button !== 0 || !open) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest(".reading-controls")) return;
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

<div class="reading-controls">
  <button
    class="btn btn--icon btn--sm"
    class:active={open}
    title="프리뷰 글꼴 크기"
    aria-label="프리뷰 글꼴 크기 조절"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >Aa</button>

  {#if open}
    <div class="reading-popover" role="group" aria-label="글꼴 크기">
      <button
        class="btn btn--icon btn--sm"
        title="글꼴 작게"
        aria-label="글꼴 작게"
        disabled={$readingFontSize <= READING_FONT_MIN}
        onclick={decreaseFontSize}
      >A−</button>
      <span class="size-value">{$readingFontSize}px</span>
      <button
        class="btn btn--icon btn--sm"
        title="글꼴 크게"
        aria-label="글꼴 크게"
        disabled={$readingFontSize >= READING_FONT_MAX}
        onclick={increaseFontSize}
      >A+</button>
      <button
        class="btn btn--sm btn--plain reset"
        title="기본값({READING_FONT_DEFAULT}px)으로"
        disabled={$readingFontSize === READING_FONT_DEFAULT}
        onclick={resetFontSize}
      >리셋</button>
    </div>
  {/if}
</div>

<style>
  .reading-controls {
    position: relative;
    display: inline-flex;
  }

  .reading-popover {
    position: absolute;
    top: calc(100% + var(--sp-2));
    right: 0;
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-3);
    background: var(--surface-overlay);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-md);
    z-index: var(--z-context-menu);
    white-space: nowrap;
  }

  .size-value {
    min-width: 40px;
    text-align: center;
    font-size: var(--fs-sm);
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .reset {
    color: var(--text-muted);
  }
  .reset:hover:not(:disabled) {
    color: var(--text-primary);
  }
</style>
