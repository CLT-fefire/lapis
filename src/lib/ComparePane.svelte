<script lang="ts">
  import { tick } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import { parseNote } from "$lib/markdown";
  import { readNote } from "$lib/tauri/notes";
  import { enhanceRendered } from "$lib/renderedEnhance";
  import { renderMermaidIn } from "$lib/mermaid-runtime";
  import { noteStem, noteDisplayName } from "$lib/notePath";
  import { readingFontSize, readingMeasureEm, readingMeasureLimited } from "$lib/stores/reading";
  import { closeCompare } from "$lib/stores/compare";
  import { selectNote } from "$lib/stores/vault";
  import { logWarn } from "$lib/stores/usage";

  /**
   * 나란히 보기 — 본문 옆의 **읽기 전용** 칸.
   *
   * ## ⚠️ 왜 본문 컴포넌트를 재사용하지 않나
   *
   * 본문은 `+page.svelte` 안에 있고 상태가 전부 싱글턴이다(`renderedArticleEl` ·
   * 편집기 · 문서 내 검색 · 읽던 자리). 떼어내려면 그 파일의 구조 개편이라, 여기서는
   * **같은 부품을 다시 조립한다** — `parseNote` · `enhanceRendered` · `renderMermaidIn`.
   *
   * 🔴 부품이 같으니 **결과도 같다.** 여기서 마크다운을 따로 파싱했다면 같은 문서가
   * 두 칸에서 다르게 보였을 것이고, 그건 이 저장소가 가장 자주 겪은 결함이다.
   *
   * ## ⚠️ 링크는 본문으로 보낸다
   *
   * 옆칸에서 위키링크를 누르면 **본문**이 그리로 간다. 옆칸이 스스로 이동하면 "어느 쪽이
   * 지금 보는 것인가"가 흐려진다 — 옆칸은 세워 둔 참고 자료다.
   */
  let { path }: { path: string } = $props();

  let raw = $state("");
  let error = $state<string | null>(null);
  let articleEl = $state<HTMLElement | null>(null);

  const parsed = $derived(parseNote(raw));

  // ⚠️ 경로가 바뀌면 다시 읽는다. `path` 를 읽어야 의존성이 걸린다.
  $effect(() => {
    const target = path;
    error = null;
    void readNote(target)
      .then((text) => {
        // 읽는 사이에 다른 노트로 바뀌었으면 버린다 — 늦게 온 응답이 새 것을 덮으면 안 된다.
        if (target !== path) return;
        raw = text;
      })
      .catch((e) => {
        if (target !== path) return;
        raw = "";
        error = e instanceof Error ? e.message : String(e);
        logWarn("ComparePane", "[compare] 못 읽었다", e);
      });
  });

  // 본문과 **같은** 후처리 — 코드 복사 버튼 · 표 정렬 · mermaid.
  $effect(() => {
    void parsed.html;
    void tick().then(() => {
      if (!articleEl) return;
      enhanceRendered(articleEl, {
        copy: m.rendered_copy(),
        copied: m.rendered_copied(),
        copyMarkdown: m.rendered_copy_markdown(),
        copyCsv: m.rendered_copy_csv(),
        sortHint: m.rendered_sort_hint(),
      });
      renderMermaidIn(articleEl);
    });
  });

  /**
   * ⚠️ 위키링크만 가로챈다. 바깥 URL 은 본문과 같은 기본 동작에 맡긴다.
   */
  function onClick(e: MouseEvent) {
    const el = (e.target as HTMLElement | null)?.closest?.("a.wikilink");
    if (!el) return;
    const target = el.getAttribute("data-target-path");
    if (!target) return;
    e.preventDefault();
    void selectNote(target, { via: "compare" });
  }
</script>

<section class="compare" data-lapis="compare-pane" aria-label={m.compare_title()}>
  <header class="head">
    <span class="name" title={path}>{noteStem(path)}</span>
    <span class="sub">{noteDisplayName(path)}</span>
    <button
      class="btn btn--icon btn--sm btn--plain close"
      title={m.compare_close()}
      aria-label={m.compare_close()}
      onclick={closeCompare}>✕</button
    >
  </header>

  <!--
    ⚠️ a11y 억제 근거 — **위임된 클릭**이다.

    본문 안의 위키링크는 `{@html}` 로 들어와 컴포넌트가 핸들러를 못 건다. 그래서 컨테이너가
    클릭을 받아 `a.wikilink` 만 가로챈다. 실제로 눌리는 것은 `<a>` 이고 키보드는 그 앵커가
    이미 받는다 — 컨테이너에 키 핸들러를 더하면 Enter 가 **두 번** 처리된다.
    본문 쪽(`+page.svelte` 의 `handlePreviewClick`)이 같은 이유로 같은 모양이다.
  -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="body" onclick={onClick}>
    {#if error}
      <!-- ⚠️ 실패를 빈 칸으로 두지 않는다 — 빈 칸은 "빈 노트"와 구별이 안 된다. -->
      <p class="error">{m.compare_read_failed()}</p>
      <p class="error-detail">{error}</p>
    {:else}
      <article
        class="rendered"
        bind:this={articleEl}
        style="--reading-font-size: {$readingFontSize}px; --reading-measure: {$readingMeasureLimited
          ? `${$readingMeasureEm}em`
          : 'none'};"
      >
        {@html parsed.html}
      </article>
    {/if}
  </div>
</section>

<style>
  .compare {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border-left: 1px solid var(--border-default);
    background: var(--surface-base);
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-3);
    border-bottom: 1px solid var(--border-subtle, var(--border-default));
    flex-shrink: 0;
  }

  .name {
    font-size: var(--fs-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-xs);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .close {
    flex-shrink: 0;
    opacity: 0.6;
  }

  .close:hover {
    opacity: 1;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--sp-4);
  }

  .error {
    margin: 0 0 var(--sp-2);
    font-size: var(--fs-sm);
    /* ⚠️ 글자색은 `--danger` 가 아니라 `--danger-text` 다 — app.css 의 계약. */
    color: var(--danger-text);
  }

  .error-detail {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-muted);
    word-break: break-word;
  }
</style>
