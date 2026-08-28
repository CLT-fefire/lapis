<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { noteStem } from "$lib/notePath";
  import ModalShell from "$lib/ModalShell.svelte";
  import { newNoteRequest, closeNewNote } from "$lib/stores/tree-ui";
  import { createNewNote, vaultPath } from "$lib/stores/vault";
  import { readVaultBundle, readNote } from "$lib/tauri/notes";
  import {
    applyTemplate,
    defaultBody,
    templateName,
    TEMPLATE_DIR,
  } from "$lib/noteTemplate";

  let fileName = $state("");
  let error = $state<string | null>(null);

  /**
   * vault 안의 템플릿 목록.
   *
   * ⚠️ **vault 안**이다(`.lapis/templates/`). 앱 설정에 담으면 vault 를 옮길 때
   * 안 따라간다 — 노트가 파일시스템에 그대로 있는 것이 이 앱의 전제다.
   */
  let templates = $state<{ path: string; name: string }[]>([]);
  let chosen = $state<string>("");

  $effect(() => {
    if ($newNoteRequest) {
      fileName = "";
      error = null;
      chosen = "";
      void loadTemplates();
    }
  });

  async function loadTemplates(): Promise<void> {
    const root = $vaultPath;
    if (!root) return;
    try {
      const bundle = await readVaultBundle(root);
      templates = bundle.contents
        .filter((c) => c.path.includes(`/${TEMPLATE_DIR}/`) || c.path.includes(`${TEMPLATE_DIR}/`))
        .map((c) => ({ path: c.path, name: templateName(c.path) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      // ⚠️ 템플릿을 못 읽어도 **새 노트는 만들 수 있어야 한다.** 목록만 빈다.
      templates = [];
    }
  }

  async function submit() {
    const req = $newNoteRequest;
    if (!req || !$vaultPath) return;
    const name = fileName.trim();
    if (!name) {
      error = m.newnote_name_required();
      return;
    }
    // ⚠️ `.mmd` 로 만들면 h1 에 확장자가 남아 있었다 — 공용 규칙을 쓴다.
    const stem = noteStem(name);

    // ⚠️ 템플릿을 **안 고른** 경우의 동작은 예전 그대로다. 이 기능은 더하는 것이지
    //    기존 흐름을 갈아치우는 것이 아니다.
    let defaultContent = defaultBody(stem);
    if (chosen) {
      try {
        const raw = await readNote(chosen);
        defaultContent = applyTemplate(raw, { title: stem, now: new Date() });
      } catch {
        // 템플릿을 못 읽으면 기본 본문으로 — 새 노트 만들기가 그것 때문에 실패하면 안 된다.
      }
    }

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
        <!--
          ⚠️ 템플릿이 **없으면 이 줄도 없다.** 늘 그리면 안 쓰는 사람에게 빈 선택칸이
          남고, 빈 선택칸은 "뭘 골라야 하나"를 묻게 만든다.
        -->
        {#if templates.length > 0}
          <div class="row">
            <label for="newnote-template">{m.newnote_template()}</label>
            <select id="newnote-template" bind:value={chosen}>
              <option value="">{m.newnote_template_none()}</option>
              {#each templates as t (t.path)}
                <option value={t.path}>{t.name}</option>
              {/each}
            </select>
          </div>
        {/if}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <p class="hint">{@html m.newnote_template_hint()}</p>
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
    color: var(--accent-text);
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

  .hint {
    margin: 8px 0 0;
    color: var(--text-muted);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }

  select {
    flex: 1;
    padding: 6px 8px;
    background: var(--surface-sunken);
    border: 1px solid var(--border-default);
    border-radius: var(--r-sm);
    color: var(--text-primary);
    font: inherit;
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
    color: var(--danger-text);
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
