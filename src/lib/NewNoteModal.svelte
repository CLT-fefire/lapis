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
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 16vh;
    z-index: 1200;
  }

  .modal {
    width: min(520px, 92vw);
    background: #1f1f1f;
    border: 1px solid #3a3a3a;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    color: #e8e8e8;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    background: #2a2a2a;
    border-bottom: 1px solid #333;
    font-weight: 600;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #6dd6ff;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: #aaa;
    font-size: 16px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .close-btn:hover {
    color: #fff;
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
    font-size: 12px;
    color: #888;
  }

  .folder {
    background: #2a2a2a;
    padding: 4px 10px;
    border-radius: 4px;
    color: #aaa;
    font-family: "SF Mono", Menlo, monospace;
    font-size: 12px;
  }

  input[type="text"] {
    flex: 1;
    background: #1a1a1a;
    border: 1px solid #444;
    color: #fff;
    padding: 6px 10px;
    border-radius: 4px;
    font-family: inherit;
    font-size: 13px;
    outline: none;
  }

  input[type="text"]:focus {
    border-color: #6dd6ff;
  }

  .error {
    color: #f47174;
    font-size: 12px;
    padding: 6px 0 0 88px;
  }

  .modal-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 14px;
    background: #2a2a2a;
    border-top: 1px solid #333;
  }

  .btn {
    padding: 6px 14px;
    border-radius: 4px;
    border: 1px solid #444;
    background: #2a2a2a;
    color: #ddd;
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .btn.cancel:hover {
    background: #333;
  }

  .btn.create {
    border-color: #6dd6ff;
    color: #6dd6ff;
    font-weight: 600;
  }

  .btn.create:hover {
    background: rgba(109, 214, 255, 0.1);
  }
</style>
