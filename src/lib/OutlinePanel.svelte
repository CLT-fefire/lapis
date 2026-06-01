<script lang="ts">
  import {
    outlineHeadings,
    activeHeadingSlug,
    jumpToHeading,
  } from "$lib/stores/outline";
</script>

{#if $outlineHeadings.length === 0}
  <div class="outline-empty">
    <p>이 노트에 헤딩(<code>#</code>)이 없습니다.</p>
    <p class="hint">헤딩을 추가하면 여기 아웃라인이 표시됩니다.</p>
  </div>
{:else}
  <nav class="outline" aria-label="문서 아웃라인">
    {#each $outlineHeadings as h (h.slug)}
      <button
        class="outline-item lvl-{h.level}"
        class:active={$activeHeadingSlug === h.slug}
        style="padding-left: {(h.level - 1) * 14 + 12}px"
        title={h.text}
        onclick={() => jumpToHeading(h)}
      >
        {h.text}
      </button>
    {/each}
  </nav>
{/if}

<style>
  .outline {
    display: flex;
    flex-direction: column;
    padding: 4px 0;
    overflow-y: auto;
  }

  .outline-item {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    border-left: 2px solid transparent;
    color: var(--text-secondary);
    font-family: inherit;
    font-size: var(--fs-sm);
    padding-top: 4px;
    padding-bottom: 4px;
    padding-right: 10px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color var(--dur-fast), background var(--dur-fast);
  }

  .outline-item:hover {
    color: var(--text-primary);
    background: var(--surface-sunken);
  }

  .outline-item.active {
    color: var(--accent);
    border-left-color: var(--accent);
    background: var(--accent-bg-subtle);
  }

  /* h1은 약간 강조, 하위 레벨은 점점 작고 흐리게 */
  .outline-item.lvl-1 {
    font-weight: 600;
    color: var(--text-primary);
  }
  .outline-item.lvl-4,
  .outline-item.lvl-5,
  .outline-item.lvl-6 {
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }

  .outline-empty {
    padding: 24px 16px;
    color: var(--text-muted);
    font-size: var(--fs-sm);
    text-align: center;
    line-height: 1.6;
  }
  .outline-empty p {
    margin: 0 0 8px 0;
  }
  .outline-empty .hint {
    font-size: var(--fs-xs);
  }
  .outline-empty code {
    font-family: var(--font-mono);
    background: var(--surface-sunken);
    padding: 1px 4px;
    border-radius: var(--r-xs);
  }
</style>
