<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import {
    outlineHeadings,
    activeHeadingSlug,
    jumpToHeading,
  } from "$lib/stores/outline";
</script>

{#if $outlineHeadings.length === 0}
  <div class="outline-empty">
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    <p>{@html m.outline_empty()}</p>
    <p class="hint">{m.outline_empty_hint()}</p>
  </div>
{:else}
  <nav class="outline" aria-label={m.outline_aria()}>
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
    /* FileTree와 같은 어휘 — 항목을 좌우에서 띄워 "칩"으로 보이게 한다.
       하단 여유는 목차가 길어 스크롤될 때 마지막 항목이 경계에 붙지 않게 한다. */
    padding: var(--sp-2);
    padding-bottom: var(--sp-5);
    overflow-y: auto;
  }

  .outline-item {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    color: var(--text-secondary);
    font-family: inherit;
    font-size: var(--fs-sm);
    /* ⚠️ **하단 잘림의 실제 원인은 flex-shrink였다**(2026-08-05).
       .outline이 flex column이라 항목이 기본값 flex-shrink:1로 압축된다 — 목차가 길수록
       심해져 clientHeight가 line-height보다 작아지고, overflow:hidden이 그 초과분을
       잘라낸다(실측: line-height 18px인데 clientHeight 16px). 스크롤은 압축이 끝난
       뒤에야 생기므로 overflow-y:auto만으로는 막지 못한다.
       line-height 명시는 글리프(한글 받침·디센더) 여유를 위해 함께 둔다. */
    flex-shrink: 0;
    line-height: 1.5;
    padding-top: var(--sp-2);
    padding-bottom: var(--sp-2);
    padding-right: var(--sp-5);
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

  /* 선택은 배경으로만 — 좌측 바는 레일의 어휘라 리스트에서는 쓰지 않는다. */
  .outline-item.active {
    color: var(--accent-text);
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
    padding: var(--sp-8) var(--sp-6);
    color: var(--text-muted);
    font-size: var(--fs-sm);
    text-align: center;
    line-height: 1.6;
  }
  .outline-empty p {
    margin: 0 0 var(--sp-4) 0;
  }
  .outline-empty .hint {
    font-size: var(--fs-xs);
  }
  /* ⚠️ `:global()` — `{@html}` 주입 요소엔 scoped CSS가 안 붙는다. */
  .outline-empty :global(code) {
    font-family: var(--font-mono);
    background: var(--surface-sunken);
    padding: 1px var(--sp-2);
    border-radius: var(--r-xs);
  }
</style>
