<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import {
    readingFontSize,
    increaseFontSize,
    decreaseFontSize,
    resetReading,
    READING_FONT_MIN,
    READING_FONT_MAX,
    READING_FONT_DEFAULT,
    readingMeasureLimited,
    readingMeasureEm,
    widenMeasure,
    narrowMeasure,
    READING_MEASURE_MIN,
    READING_MEASURE_DEFAULT,
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
    title={m.reading_font_size_title()}
    aria-label={m.reading_font_size_aria()}
    aria-expanded={open}
    onclick={() => (open = !open)}
  >Aa</button>

  {#if open}
    <div class="reading-popover" role="group" aria-label={m.reading_popover_aria()}>
      <div class="row">
        <span class="row-label">{m.reading_font_row()}</span>
        <button
          class="btn btn--icon btn--sm"
          title={m.reading_font_smaller()}
          aria-label={m.reading_font_smaller()}
          disabled={$readingFontSize <= READING_FONT_MIN}
          onclick={decreaseFontSize}
        >A−</button>
        <span class="row-value">{$readingFontSize}px</span>
        <button
          class="btn btn--icon btn--sm"
          title={m.reading_font_larger()}
          aria-label={m.reading_font_larger()}
          disabled={$readingFontSize >= READING_FONT_MAX}
          onclick={increaseFontSize}
        >A+</button>
      </div>

      <div class="row">
        <span class="row-label">{m.reading_measure_row()}</span>
        <button
          class="btn btn--icon btn--sm"
          title={m.reading_measure_narrower()}
          aria-label={m.reading_measure_narrower()}
          disabled={$readingMeasureLimited && $readingMeasureEm <= READING_MEASURE_MIN}
          onclick={narrowMeasure}
        >◀</button>
        <!-- 한글은 전각이라 `Nem ≈ 한 줄 N자`가 거의 그대로 성립한다 — em보다 읽는 사람에게
             의미 있는 단위. -->
        <span class="row-value">
          {$readingMeasureLimited
            ? m.reading_measure_value({ chars: $readingMeasureEm })
            : m.reading_measure_unlimited()}
        </span>
        <button
          class="btn btn--icon btn--sm"
          title={m.reading_measure_wider()}
          aria-label={m.reading_measure_wider()}
          disabled={!$readingMeasureLimited}
          onclick={widenMeasure}
        >▶</button>
      </div>

      <button
        class="btn btn--sm btn--plain reset"
        title={m.reading_reset_title({ font: READING_FONT_DEFAULT, measure: READING_MEASURE_DEFAULT })}
        disabled={$readingFontSize === READING_FONT_DEFAULT &&
          $readingMeasureLimited &&
          $readingMeasureEm === READING_MEASURE_DEFAULT}
        onclick={resetReading}
      >{m.reading_reset()}</button>
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
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--sp-2);
    padding: var(--sp-3);
    background: var(--surface-overlay);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-md);
    z-index: var(--z-context-menu);
    white-space: nowrap;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .row-label {
    /* 두 행의 컨트롤이 세로로 정렬되도록 라벨 폭을 고정. */
    min-width: 48px;
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }

  .row-value {
    min-width: 58px;
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
