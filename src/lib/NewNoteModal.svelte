<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import ModalShell from "$lib/ModalShell.svelte";
  import { newNoteRequest, closeNewNote } from "$lib/stores/tree-ui";
  import { createNewNote, vaultPath } from "$lib/stores/vault";

  let fileName = $state("");
  let error = $state<string | null>(null);

  $effect(() => {
    if ($newNoteRequest) {
      fileName = "";
      error = null;
    }
  });

  async function submit() {
    const req = $newNoteRequest;
    if (!req || !$vaultPath) return;
    const name = fileName.trim();
    if (!name) {
      error = m.newnote_name_required();
      return;
    }
    // 단순 default 콘텐츠 — Phase 4.2에서 템플릿으로 확장 예정
    const today = new Date().toISOString().slice(0, 10);
    const stem = name.replace(/\.md$/i, "");
    const defaultContent = `# ${stem}\n\n`;

    const newPath = await createNewNote(req.parentDir, name, defaultContent);
    if (newPath) {
      closeNewNote();
    } else {
      error = m.newnote_create_failed();
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
    // Escape/backdrop 닫기는 ModalShell이 처리.
  }
</script>

{#if $newNoteRequest}
  {@const req = $newNoteRequest}
  <ModalShell onClose={closeNewNote} align="top" label={m.newnote_aria()}>
    <div class="modal" role="dialog" aria-modal="true" aria-label={m.newnote_aria()}>
      <header class="modal-head">
        <span>{m.newnote_title()}</span>
        <button class="btn btn--icon btn--sm btn--plain" onclick={closeNewNote} title={m.newnote_close()}>×</button>
      </header>
      <div class="modal-body">
        <div class="row">
          <span class="label-text">{m.newnote_folder()}</span>
          <span class="folder">{req.parentLabel}</span>
        </div>
        <div class="row">
          <label for="newnote-name">{m.newnote_filename()}</label>
          <input
            id="newnote-name"
            data-autofocus
            bind:value={fileName}
            type="text"
            placeholder="example or example.md"
            onkeydown={onKey}
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        {#if error}
          <div class="error">{error}</div>
        {/if}
      </div>
      <footer class="modal-foot">
        <button class="btn btn--ghost" onclick={closeNewNote}>{m.newnote_cancel()}</button>
        <button class="btn btn--primary" onclick={submit}>Create &amp; Open</button>
      </footer>
    </div>
  </ModalShell>
{/if}

<style>
  .modal {
    width: min(520px, 92vw);
    background: var(--surface-overlay);
    border: 1px solid var(--border-default);
    border-radius: var(--r-lg);
    overflow: hidden;
    box-shadow: var(--shadow-overlay);
    color: var(--text-primary);
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px var(--sp-6);
    background: var(--surface-overlay);
    border-bottom: 1px solid var(--border-default);
    font-weight: 600;
    font-size: var(--fs-base);
    letter-spacing: 0.01em;
    color: var(--accent);
  }

  .modal-body {
    padding: var(--sp-6) 18px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }

  .row label,
  .row .label-text {
    width: 78px;
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }

  .folder {
    background: var(--surface-overlay);
    padding: var(--sp-2) 10px;
    border-radius: var(--r-sm);
    color: var(--text-secondary);
    font-family: "SF Mono", Menlo, monospace;
    font-size: var(--fs-sm);
  }

  input[type="text"] {
    flex: 1;
    background: var(--surface-sunken);
    border: 1px solid var(--border-strong);
    color: var(--text-primary);
    padding: var(--sp-3) 10px;
    border-radius: var(--r-sm);
    font-family: inherit;
    font-size: var(--fs-base);
  }

  input[type="text"]:focus {
    border-color: var(--accent);
  }

  .error {
    color: var(--danger);
    font-size: var(--fs-sm);
    padding: var(--sp-3) 0 0 88px;
  }

  .modal-foot {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-4);
    padding: 10px 14px;
    background: var(--surface-overlay);
    border-top: 1px solid var(--border-default);
  }

  /* 액션 버튼은 app.css의 .btn 프리미티브 사용 (.btn--ghost / .btn--primary) */
</style>
