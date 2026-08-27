<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { css as cssLang } from "@codemirror/lang-css";
  import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
  import { tags as t } from "@lezer/highlight";
  import { m } from "$lib/paraglide/messages.js";
  import { customCss, customCssEnabled, applyCustomCss, setCustomCssEnabled } from "$lib/stores/settings";
  import { formatCss, CssFormatError } from "$lib/cssFormat";
  import { LAPIS_HOOKS, EXAMPLE_CSS } from "$lib/userCss";

  /**
   * 사용자 정의 CSS 편집기.
   *
   * ⚠️ **저장은 명시적이다.** 타이핑마다 저장하면 `[data-lapis="app"] { display: none`을
   * 치는 도중 앱이 사라진다 — 닫는 중괄호를 치기 전에.
   */

  let host = $state<HTMLDivElement | null>(null);
  let view: EditorView | null = null;
  let draft = $state("");
  let error = $state<string | null>(null);
  let saved = $state(false);

  const dirty = $derived(draft !== $customCss);

  /** CSS 문법 색 — `app.css`의 `--cm-*` 토큰을 쓴다(에디터와 같은 팔레트). */
  const highlight = HighlightStyle.define([
    { tag: t.keyword, color: "var(--cm-keyword)" },
    { tag: [t.propertyName, t.attributeName], color: "var(--cm-heading)" },
    { tag: [t.className, t.typeName, t.tagName], color: "var(--cm-link)" },
    { tag: [t.string, t.special(t.string)], color: "var(--cm-string)" },
    { tag: [t.number, t.unit, t.color, t.atom], color: "var(--cm-number)" },
    { tag: t.comment, color: "var(--cm-comment)", fontStyle: "italic" },
    { tag: t.variableName, color: "var(--cm-code)" },
    { tag: t.operator, color: "var(--cm-meta)" },
  ]);

  onMount(() => {
    // ⚠️ 저장된 값이 비었으면 **예시로 시작한다.** 저장된 기본값을 예시로 두지 않는
    //    이유는 `EXAMPLE_CSS` 주석 참조 — "비어 있음"이 사라지면 안 된다.
    draft = $customCss === "" ? EXAMPLE_CSS : $customCss;
    view = new EditorView({
      parent: host!,
      state: EditorState.create({
        doc: draft,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          cssLang(),
          syntaxHighlighting(highlight),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              draft = u.state.doc.toString();
              error = null;
              saved = false;
            }
          }),
        ],
      }),
    });
  });

  onDestroy(() => view?.destroy());

  function setDoc(next: string): void {
    if (!view) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
  }

  async function onFormat(): Promise<void> {
    try {
      setDoc(await formatCss(draft));
      error = null;
    } catch (e) {
      // ⚠️ 포매팅 실패를 **문법 오류 표시로 쓴다.** 별도 린터를 두지 않는다.
      error = e instanceof CssFormatError ? e.message : String(e);
    }
  }

  async function onSave(): Promise<void> {
    await applyCustomCss(draft);
    saved = true;
  }

  function onRevert(): void {
    setDoc($customCss);
    error = null;
  }
</script>

<section class="setting-row css-row">
  <div class="setting-label">
    <span class="label-text">
      <span class="label-title">{m.settings_css_title()}</span>
      <span class="label-desc">{m.settings_css_desc()}</span>
    </span>
  </div>

  <div class="css-control">
    <div class="css-toolbar">
      <label class="css-toggle">
        <input
          type="checkbox"
          checked={$customCssEnabled}
          onchange={(e) => void setCustomCssEnabled(e.currentTarget.checked)}
        />
        {m.settings_css_enabled()}
      </label>
      <div class="css-actions">
        <button class="btn btn--ghost btn--sm" onclick={() => setDoc(EXAMPLE_CSS)}>
          {m.settings_css_example()}
        </button>
        <button class="btn btn--ghost btn--sm" onclick={() => void onFormat()}>
          {m.settings_css_format()}
        </button>
        <button class="btn btn--ghost btn--sm" disabled={!dirty} onclick={onRevert}>
          {m.settings_css_revert()}
        </button>
        <button class="btn btn--sm" disabled={!dirty} onclick={() => void onSave()}>
          {m.settings_css_save()}
        </button>
      </div>
    </div>

    <div class="css-editor" bind:this={host}></div>

    {#if error}
      <p class="css-msg error">{error}</p>
    {:else if saved}
      <p class="css-msg ok">{m.settings_css_saved()}</p>
    {:else if dirty}
      <p class="css-msg">{m.settings_css_dirty()}</p>
    {/if}

    <!--
      ⚠️ 되돌리는 길을 **여기에 적어 둔다.** 앱을 못 쓰게 만드는 CSS를 쓰면 이 화면에
      다시 못 들어오므로, 그때 읽을 수 있는 곳은 이 문구를 기억하는 것뿐이다.
    -->
    <p class="css-help">{m.settings_css_panic()}</p>

    <details class="css-hooks">
      <summary>{m.settings_css_hooks()}</summary>
      <div class="hook-list">
        {#each LAPIS_HOOKS as h (h)}
          <code>[data-lapis="{h}"]</code>
        {/each}
      </div>
      <p class="css-help">{m.settings_css_hooks_note()}</p>
    </details>
  </div>
</section>

<style>
  .css-row {
    flex-direction: column;
    align-items: stretch;
    gap: var(--sp-4);
  }

  .css-control {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }

  .css-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-4);
  }

  .css-toggle {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    color: var(--text-secondary);
    font-size: var(--fs-sm);
  }

  .css-actions {
    display: flex;
    gap: var(--sp-3);
  }

  .css-editor {
    height: 240px;
    overflow: auto;
    background: var(--surface-sunken);
    border: 1px solid var(--border-default);
    border-radius: var(--r-md);
  }

  .css-msg {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }
  .css-msg.error {
    color: var(--danger);
    white-space: pre-wrap;
  }
  .css-msg.ok {
    color: var(--success);
  }

  .css-help {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-muted);
    line-height: 1.5;
  }

  .css-hooks summary {
    cursor: pointer;
    color: var(--text-secondary);
    font-size: var(--fs-sm);
  }

  .hook-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
    padding: var(--sp-3) 0;
  }
  .hook-list code {
    padding: 2px var(--sp-3);
    background: var(--surface-sunken);
    border-radius: var(--r-sm);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }
</style>
