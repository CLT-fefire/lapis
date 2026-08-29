<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import {
    outlineHeadings,
    activeHeadingSlug,
    jumpToHeading,
  } from "$lib/stores/outline";
  import { currentNotePath } from "$lib/stores/vault";
  import { headingLinkFor } from "$lib/headingLink";
  import { logWarn } from "$lib/stores/usage";

  /** 방금 복사한 헤딩 — 눌렀다는 것을 잠깐 보여준다. */
  let copied = $state<string | null>(null);

  /**
   * 이 헤딩으로 가는 위키링크를 복사한다.
   *
   * ⚠️ 만들 수 없는 헤딩(`]]`·`|`·`#` 가 든 것)은 **버튼을 아예 안 낸다.** 깨진 링크를
   * 주면 붙여넣은 사람이 한참 뒤에야 안다.
   */
  async function copyLink(text: string): Promise<void> {
    const link = headingLinkFor($currentNotePath ?? "", text);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      copied = text;
      setTimeout(() => {
        if (copied === text) copied = null;
      }, 1200);
    } catch (e) {
      logWarn("OutlinePanel", "헤딩 링크 복사 실패", e);
    }
  }
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
      <div class="outline-row">
        <button
          class="outline-item lvl-{h.level}"
          class:active={$activeHeadingSlug === h.slug}
          style="padding-left: {(h.level - 1) * 14 + 12}px"
          title={h.text}
          onclick={() => jumpToHeading(h)}
        >
          {h.text}
        </button>
        {#if headingLinkFor($currentNotePath ?? "", h.text)}
          <button
            class="outline-copy"
            title={m.outline_copy_link()}
            aria-label={m.outline_copy_link()}
            onclick={() => copyLink(h.text)}
          >
            {copied === h.text ? "✓" : "⧉"}
          </button>
        {/if}
      </div>
    {/each}
  </nav>
{/if}

<style>
  /* 항목 한 줄 — 글자와 복사 버튼. 버튼은 호버·초점에만 보인다. */
  .outline-row {
    display: flex;
    align-items: center;
  }

  .outline-row .outline-item {
    flex: 1;
    min-width: 0;
  }

  .outline-copy {
    flex: none;
    opacity: 0;
    padding: 0 var(--sp-2);
    border: 0;
    background: none;
    color: var(--text-muted);
    font-size: var(--fs-xs);
    cursor: pointer;
  }

  /*
    ⚠️ **초점에도 보여야 한다.** 호버로만 드러내면 키보드로는 있는 줄도 모른다 —
    이 앱에서 실제로 그 종류의 결함이 셋 나왔다.
  */
  .outline-row:hover .outline-copy,
  .outline-copy:focus-visible {
    opacity: 1;
  }

  .outline-copy:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    border-radius: var(--r-sm);
  }

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
