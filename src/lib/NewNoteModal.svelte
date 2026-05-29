<script lang="ts">
  import { tick } from "svelte";
  import { newNoteRequest, closeNewNote } from "$lib/stores/tree-ui";
  import { createNewNote, vaultPath } from "$lib/stores/vault";

  let inputEl: HTMLInputElement | null = $state(null);
  let fileName = $state("");
  let error = $state<string | null>(null);

  $effect(() => {
    if ($newNoteRequest) {
      fileName = "";
      error = null;
      tick().then(() => inputEl?.focus());
    }
  });

  async function submit() {
    const req = $newNoteRequest;
    if (!req || !$vaultPath) return;
    const name = fileName.trim();
    if (!name) {
      error = "이름을 입력하세요";
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
      error = "생성 실패 — 같은 이름 파일이 이미 있거나 경로가 잘못되었습니다";
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeNewNote();
    }
  }

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) closeNewNote();
  }
</script>

{#if $newNoteRequest}
  {@const req = $newNoteRequest}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={onBackdrop}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="New note">
      <header class="modal-head">
        <span>New Note</span>
        <button class="close-btn" onclick={closeNewNote} title="닫기 (Esc)">×</button>
      </header>
      <div class="modal-body">
        <div class="row">
          <span class="label-text">Folder</span>
          <span class="folder">{req.parentLabel}</span>
        </div>
        <div class="row">
          <label for="newnote-name">File name</label>
          <input
            id="newnote-name"
            bind:this={inputEl}
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
        <button class="btn cancel" onclick={closeNewNote}>Cancel</button>
        <button class="btn create" onclick={submit}>Create &amp; Open</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 16vh;
    z-index: 1200;
  }

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
    padding: 10px 16px;
    background: var(--surface-overlay);
    border-bottom: 1px solid var(--border-default);
    font-weight: 600;
    font-size: var(--fs-base);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
  }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: var(--fs-lg);
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .close-btn:hover {
    color: var(--text-primary);
  }

  .modal-body {
    padding: 16px 18px;
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
    padding: 4px 10px;
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
    padding: 6px 10px;
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
    padding: 6px 0 0 88px;
  }

  .modal-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 14px;
    background: var(--surface-overlay);
    border-top: 1px solid var(--border-default);
  }

  .btn {
    padding: 6px 14px;
    border-radius: var(--r-sm);
    border: 1px solid var(--border-strong);
    background: var(--surface-overlay);
    color: var(--text-secondary);
    font-family: inherit;
    font-size: var(--fs-sm);
    cursor: pointer;
  }

  .btn.cancel:hover {
    background: var(--border-default);
  }

  .btn.create {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }

  .btn.create:hover {
    background: var(--accent-bg-subtle);
  }
</style>
