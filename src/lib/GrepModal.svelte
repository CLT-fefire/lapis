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
    await selectNote(hit.path);
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
        <button class="x" onclick={closeGrep} aria-label="✕">✕</button>
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
</style>
