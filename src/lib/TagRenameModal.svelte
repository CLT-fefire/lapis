<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import ModalShell from "$lib/ModalShell.svelte";
  import {
    tagRenameOpen,
    tagRenameOld,
    tagRenameNew,
    tagRenamePreview,
    tagRenameBusy,
    tagRenameError,
    closeTagRename,
    computeTagRenamePreview,
    applyTagRename,
    knownTags,
  } from "$lib/stores/tagRewrite";

  /** 자동완성 목록 — 모달이 열려 있을 때만 계산한다. */
  const tags = $derived($tagRenameOpen ? knownTags() : []);

  const canPreview = $derived(
    !$tagRenameBusy && $tagRenameOld.trim() !== "" && $tagRenameNew.trim() !== "",
  );
  const canApply = $derived(
    !$tagRenameBusy && ($tagRenamePreview?.items.length ?? 0) > 0,
  );

  /** 입력이 바뀌면 미리보기를 버린다 — 옛 결과를 새 입력의 것으로 오인하면 안 된다. */
  function invalidate() {
    tagRenamePreview.set(null);
  }
</script>

{#if $tagRenameOpen}
  <ModalShell onClose={closeTagRename} label={m.tagrename_title()}>
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1">
      <header>
        <h2>{m.tagrename_title()}</h2>
        <button class="x" onclick={closeTagRename} aria-label="✕">✕</button>
      </header>

      <div class="form">
        <label>
          <span>{m.tagrename_old()}</span>
          <input
            data-autofocus
            list="lapis-tag-list"
            bind:value={$tagRenameOld}
            oninput={invalidate}
            spellcheck="false"
            autocomplete="off"
          />
        </label>
        <label>
          <span>{m.tagrename_new()}</span>
          <input
            bind:value={$tagRenameNew}
            oninput={invalidate}
            spellcheck="false"
            autocomplete="off"
          />
        </label>
        <datalist id="lapis-tag-list">
          {#each tags as t (t)}<option value={t}></option>{/each}
        </datalist>
      </div>

      <p class="hint">{m.tagrename_children_note()}</p>

      {#if $tagRenameError}
        <p class="error">{$tagRenameError}</p>
      {:else if $tagRenamePreview}
        {#if $tagRenamePreview.items.length === 0}
          <p class="summary">{m.tagrename_none()}</p>
        {:else}
          <p class="summary">
            {m.tagrename_summary({
              notes: $tagRenamePreview.items.length,
              total: $tagRenamePreview.totalOccurrences,
            })}
          </p>
          {#if $tagRenamePreview.merge}
            <p class="warn">{m.tagrename_merge_warn()}</p>
          {/if}
          <ul class="affected">
            {#each $tagRenamePreview.items as item (item.path)}
              <li>
                <span class="path" title={item.path}>{item.path}</span>
                <span class="count">{item.occurrences}</span>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}

      <p class="hint backup">{m.tagrename_backup_note()}</p>

      <footer>
        <button class="btn btn--ghost" onclick={closeTagRename}>{m.tagrename_cancel()}</button>
        <button class="btn" disabled={!canPreview} onclick={() => computeTagRenamePreview()}>
          {$tagRenameBusy ? m.tagrename_busy() : m.tagrename_preview()}
        </button>
        <button class="btn btn--primary" disabled={!canApply} onclick={() => applyTagRename()}>
          {m.tagrename_apply()}
        </button>
      </footer>
    </div>
  </ModalShell>
{/if}

<style>
  .modal {
    background: var(--surface-overlay);
    color: var(--text-primary);
    border: 1px solid var(--border-default);
    border-radius: var(--r-lg);
    width: 580px;
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 80px);
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-overlay);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--border-subtle);
  }

  h2 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
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

  .form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px 8px;
  }

  .form label {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.82rem;
    color: var(--text-secondary);
  }

  .form label span {
    min-width: 6.5em;
    flex-shrink: 0;
  }

  .form input {
    flex: 1;
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    color: var(--text-primary);
    padding: 6px 9px;
    font-size: 0.85rem;
    font-family: inherit;
  }
  .form input:focus {
    outline: none;
    border-color: var(--accent-border);
  }

  .summary,
  .hint,
  .error,
  .warn {
    margin: 0;
    padding: 8px 16px;
    font-size: 0.78rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .hint {
    color: var(--text-muted);
  }
  .backup {
    border-top: 1px solid var(--border-subtle);
  }
  .error {
    color: var(--text-primary);
    background: var(--surface-sunken);
  }
  .warn {
    color: var(--accent-fg);
    background: var(--accent-bg-subtle);
  }

  .affected {
    list-style: none;
    margin: 0;
    padding: 0 16px 8px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .affected li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 2px 0;
    font-size: 0.78rem;
    color: var(--text-secondary);
  }

  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px 14px;
    border-top: 1px solid var(--border-subtle);
  }
</style>
