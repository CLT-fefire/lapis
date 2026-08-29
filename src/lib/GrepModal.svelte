<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import ModalShell from "$lib/ModalShell.svelte";
  import {
    grepOpen,
    grepPattern,
    grepRegex,
    grepCase,
    grepWholeWord,
    grepRunning,
    grepResult,
    grepError,
    closeGrep,
    runGrep,
    grepReplacement,
    replacePreview,
    replaceBusy,
    replaceError,
    replaceEngineSkew,
    computeReplace,
    applyReplace,
    resetReplace,
  } from "$lib/stores/grep";
  import { selectNote } from "$lib/stores/vault";
  import { applySearch } from "$lib/stores/inDocSearch";
  import { mainPane } from "$lib/stores/layout";
  import type { GrepHit } from "$lib/tauri/grep";

  /** 파일별로 묶어 보여준다 — 같은 노트의 여러 줄이 흩어져 있으면 읽기 어렵다. */
  const grouped = $derived.by(() => {
    const r = $grepResult;
    if (!r) return [] as { path: string; name: string; hits: GrepHit[] }[];
    const map = new Map<string, GrepHit[]>();
    for (const h of r.hits) {
      const arr = map.get(h.path);
      if (arr) arr.push(h);
      else map.set(h.path, [h]);
    }
    return [...map.entries()].map(([path, hits]) => ({
      path,
      name: path.split("/").pop() ?? path,
      hits,
    }));
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      void runGrep();
    }
  }

  async function go(hit: GrepHit) {
    closeGrep();
    await selectNote(hit.path, { via: "search" });
    // 문서 맨 위가 아니라 **찾은 자리**에서 시작하게 한다.
    applySearch(
      $grepPattern,
      { regex: $grepRegex, caseSensitive: $grepCase, wholeWord: $grepWholeWord },
      $mainPane === "editor" ? "editor" : "preview",
    );
  }

  /** 매치 구간만 강조. 오프셋은 Rust가 UTF-16으로 준 값이라 그대로 slice 한다. */
  function parts(h: GrepHit): [string, string, string] {
    const a = h.text.slice(0, h.col);
    const b = h.text.slice(h.col, h.col + h.len);
    const c = h.text.slice(h.col + h.len);
    return [a, b, c];
  }
</script>

{#if $grepOpen}
  <ModalShell onClose={closeGrep} label={m.grep_title()} align="top">
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1">
      <header>
        <input
          data-autofocus
          type="text"
          bind:value={$grepPattern}
          onkeydown={onKey}
          placeholder={m.grep_placeholder()}
          spellcheck="false"
          autocomplete="off"
        />
        <button class="x" onclick={closeGrep} aria-label={m.modal_close()}>✕</button>
      </header>

      <div class="opts">
        <label><input type="checkbox" bind:checked={$grepCase} />Aa</label>
        <label><input type="checkbox" bind:checked={$grepWholeWord} />{m.grep_whole_word()}</label>
        <label><input type="checkbox" bind:checked={$grepRegex} />.*</label>
        <button class="run" onclick={() => runGrep()} disabled={$grepRunning || !$grepPattern}>
          {$grepRunning ? m.grep_running() : m.grep_run()}
        </button>
      </div>

      {#if $grepError}
        <p class="error">{$grepError}</p>
      {:else if $grepResult}
        <p class="summary">
          {m.grep_summary({
            hits: $grepResult.hits.length,
            files: $grepResult.files,
            scanned: $grepResult.scanned,
          })}
          {#if $grepResult.truncated}<strong>{m.grep_truncated()}</strong>{/if}
        </p>
      {/if}

      <!--
        찾아 바꾸기 — 검색 결과가 있을 때만 낸다.

        ⚠️ 건수는 **치환 엔진이 낸 것**이다. 검색은 Rust `regex`, 치환은 JS `RegExp`라
        매치 지점이 다를 수 있어서, grep 숫자를 그대로 쓰면 "보여준 것과 바꾼 것이
        다른" 상태가 조용히 생긴다. 자세한 근거는 `stores/grep.ts`.
      -->
      {#if $grepResult && $grepResult.hits.length > 0}
        <div class="replace-row">
          <input
            type="text"
            bind:value={$grepReplacement}
            placeholder={m.grep_replace_placeholder()}
            spellcheck="false"
            autocomplete="off"
          />
          <button
            class="run"
            onclick={() => computeReplace()}
            disabled={$replaceBusy || $grepRunning}
          >
            {m.grep_replace_preview()}
          </button>
        </div>

        {#if $replaceError}
          <p class="error">{$replaceError}</p>
        {:else if $replacePreview}
          {@const rp = $replacePreview}
          <div class="replace-panel">
            {#if rp.items.length === 0}
              <p class="summary">{m.grep_replace_none()}</p>
            {:else}
              <!-- 위험 신호를 목록보다 **먼저** 낸다. 아래로 밀리면 없는 것과 같다. -->
              {#if rp.selfMatching}
                <p class="warn">{m.grep_replace_warn_self()}</p>
              {/if}
              {#if rp.frontmatterOccurrences > 0}
                <p class="warn">
                  {m.grep_replace_warn_fm({ count: rp.frontmatterOccurrences })}
                </p>
              {/if}
              {#if $replaceEngineSkew > 0}
                <p class="warn">{m.grep_replace_warn_skew({ count: $replaceEngineSkew })}</p>
              {/if}
              <p class="summary">
                {m.grep_replace_summary({
                  files: rp.items.length,
                  occurrences: rp.totalOccurrences,
                })}
              </p>
              <div class="replace-actions">
                <button class="apply" onclick={() => applyReplace()} disabled={$replaceBusy}>
                  {m.grep_replace_apply({ files: rp.items.length })}
                </button>
                <button class="cancel" onclick={() => resetReplace()} disabled={$replaceBusy}>
                  {m.grep_replace_cancel()}
                </button>
              </div>
              <p class="hint">{m.grep_replace_hint()}</p>
            {/if}
          </div>
        {/if}
      {/if}

      <div class="results">
        {#each grouped as g (g.path)}
          <div class="file">
            <div class="fname" title={g.path}>{g.name}</div>
            {#each g.hits as h (h.line)}
              {@const [pre, mid, post] = parts(h)}
              <button class="hit" onclick={() => go(h)}>
                <span class="ln">{h.line}</span>
                <span class="txt"
                  >{#if h.clipped}…{/if}{pre}<mark>{mid}</mark>{post}{#if h.clipped}…{/if}</span
                >
              </button>
            {/each}
          </div>
        {/each}
      </div>

      <p class="hint">{m.grep_hint()}</p>
    </div>
  </ModalShell>
{/if}

<style>
  .modal {
    background: var(--surface-overlay);
    color: var(--text-primary);
    border: 1px solid var(--border-default);
    border-radius: var(--r-lg);
    width: 720px;
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 140px);
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-overlay);
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border-subtle);
  }

  header input {
    flex: 1;
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    color: var(--text-primary);
    padding: 7px 10px;
    font-size: 0.9rem;
    font-family: inherit;
  }
  header input:focus {
    outline: none;
    border-color: var(--accent-border);
  }

  .x {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--r-sm);
  }
  .x:hover {
    background: var(--surface-raised);
    color: var(--text-primary);
  }

  .opts {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 0.78rem;
    color: var(--text-secondary);
  }
  .opts label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
  }
  .run {
    margin-left: auto;
    background: var(--accent-bg-subtle);
    border: 1px solid var(--accent-border);
    color: var(--accent-fg);
    border-radius: var(--r-sm);
    padding: 4px 12px;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .run:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .summary,
  .error,
  .hint {
    margin: 0;
    padding: 9px 14px;
    font-size: 0.78rem;
    color: var(--text-secondary);
  }
  .error {
    color: var(--text-primary);
    background: var(--surface-sunken);
  }
  .hint {
    border-top: 1px solid var(--border-subtle);
    color: var(--text-muted);
  }

  .results {
    overflow-y: auto;
    flex: 1;
    padding: 0 6px 6px;
  }

  .file {
    padding: 6px 0;
    border-top: 1px solid var(--border-subtle);
  }

  .fname {
    font-size: 0.78rem;
    color: var(--text-muted);
    padding: 0 8px 3px;
  }

  .hit {
    display: flex;
    gap: 10px;
    width: 100%;
    background: none;
    border: none;
    padding: 3px 8px;
    text-align: left;
    cursor: pointer;
    border-radius: var(--r-sm);
    color: var(--text-secondary);
    font-size: 0.8rem;
    font-family: inherit;
  }
  .hit:hover {
    background: var(--surface-raised);
    color: var(--text-primary);
  }

  .ln {
    color: var(--text-muted);
    min-width: 3.2em;
    text-align: right;
    flex-shrink: 0;
  }

  .txt {
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  mark {
    background: var(--accent-bg-subtle);
    color: var(--accent-fg);
    border-radius: 2px;
  }

  /* 찾아 바꾸기 */
  .replace-row {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 0 16px 8px;
  }
  .replace-row input {
    flex: 1;
    background: var(--surface-sunken);
    border: 1px solid var(--border-default);
    border-radius: var(--r-sm);
    color: var(--text-primary);
    font-size: 0.85rem;
    padding: 5px 8px;
  }
  .replace-panel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0 16px 10px;
    padding: 10px 12px;
    border: 1px solid var(--warning-border);
    border-radius: var(--r-md);
    background: var(--warning-bg-subtle);
  }
  .warn {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.5;
    color: var(--text-primary);
  }
  .replace-actions {
    display: flex;
    gap: 8px;
    padding-top: 2px;
  }
  .apply,
  .cancel {
    border-radius: var(--r-sm);
    cursor: pointer;
    font-size: 0.8rem;
    padding: 5px 10px;
  }
  .apply {
    background: var(--danger);
    border: 1px solid var(--danger-border);
    color: var(--n-0);
  }
  .cancel {
    background: none;
    border: 1px solid var(--border-default);
    color: var(--text-secondary);
  }
  .apply:disabled,
  .cancel:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
