<script lang="ts">
  import { onMount, tick } from "svelte";
  import Editor from "$lib/Editor.svelte";
  import Sidebar from "$lib/Sidebar.svelte";
  import { parseNote } from "$lib/markdown";
  import {
    vaultPath,
    currentNotePath,
    currentNoteContent,
    restoreLastVault,
  } from "$lib/stores/vault";
  import {
    editorCollapsed,
    previewCollapsed,
    toggleEditor,
    togglePreview,
    restorePaneState,
  } from "$lib/stores/layout";

  const SAMPLE = `---
title: Lapis Phase 1.1 Welcome
status: read-only
tags: [phase-1, vault-reader]
---

# Lapis — Vault Reader

좌측 상단의 **Vault 열기** 버튼으로 마크다운이 들어 있는 폴더를 지정하세요.

선택 후엔 트리에서 노트를 클릭하면 이 영역에 본문이, 우측에 렌더링이 표시됩니다.

## 추천 vault

- \`/Users/Shared/Source/SharedDocs/MyProject\` — 기존 306개+ 노트 vault
- \`/Users/Shared/Source/Lapis/docs\` — 이 프로젝트 자체의 PLAN.md

## Phase 1.1에서 가능한 것

- 폴더 트리 항해 (재귀, 폴더 우선 정렬)
- 노트 클릭 → 본문 로드 + 실시간 렌더
- 마지막 vault 자동 복원 (재시작 시)

## Phase 1.1에서 아직 안 되는 것

- 편집 후 저장 (read-only)
- 외부 변경 자동 감지
- Wikilink \`[[다른노트]]\` 점프
- 검색 / Quick Switcher
`;

  let raw = $state(SAMPLE);

  $effect(() => {
    if ($currentNotePath) {
      raw = $currentNoteContent;
    } else if (!$vaultPath) {
      raw = SAMPLE;
    }
  });

  const parsed = $derived(parseNote(raw));

  function noteDisplayName(path: string): string {
    const segments = path.split("/").filter(Boolean);
    return segments.slice(-2).join(" / ");
  }

  let editorCopied = $state(false);
  let previewCopied = $state(false);
  let editorCopyTimer: ReturnType<typeof setTimeout> | null = null;
  let previewCopyTimer: ReturnType<typeof setTimeout> | null = null;

  function flashCopied(target: "editor" | "preview") {
    if (target === "editor") {
      editorCopied = true;
      if (editorCopyTimer) clearTimeout(editorCopyTimer);
      editorCopyTimer = setTimeout(() => (editorCopied = false), 1200);
    } else {
      previewCopied = true;
      if (previewCopyTimer) clearTimeout(previewCopyTimer);
      previewCopyTimer = setTimeout(() => (previewCopied = false), 1200);
    }
  }

  async function copyEditor() {
    try {
      await navigator.clipboard.writeText(raw);
      flashCopied("editor");
    } catch (e) {
      console.error("editor copy failed", e);
    }
  }

  // Preview는 리치 텍스트로 복사 (HTML + 평문 fallback)
  // Confluence/메일/Slack 등 rich text 입력란에 붙여넣으면 서식 그대로 들어감
  async function copyPreview() {
    const tmp = document.createElement("div");
    tmp.innerHTML = parsed.html;
    const plain = tmp.textContent ?? "";

    try {
      const blobHtml = new Blob([parsed.html], { type: "text/html" });
      const blobText = new Blob([plain], { type: "text/plain" });
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": blobHtml,
          "text/plain": blobText,
        }),
      ]);
      flashCopied("preview");
    } catch (e) {
      console.warn("rich copy failed, fallback to plain text", e);
      try {
        await navigator.clipboard.writeText(plain);
        flashCopied("preview");
      } catch (e2) {
        console.error("preview copy failed entirely", e2);
      }
    }
  }

  // Editor↔Preview 비율 기반 스크롤 동기화 — 마우스 hover로 source 결정 (무한 루프 방지)
  $effect(() => {
    // collapse 상태에 의존성 등록 → 펼침/접힘 시 자동 재셋업
    const _e = $editorCollapsed;
    const _p = $previewCollapsed;

    let editorScroller: HTMLElement | null = null;
    let previewBody: HTMLElement | null = null;
    let activeSource: "editor" | "preview" | null = null;
    let cleaned = false;

    const onEditorEnter = () => (activeSource = "editor");
    const onPreviewEnter = () => (activeSource = "preview");

    const onEditorScroll = () => {
      if (activeSource !== "editor" || !editorScroller || !previewBody) return;
      const eMax = editorScroller.scrollHeight - editorScroller.clientHeight;
      if (eMax <= 0) return;
      const ratio = editorScroller.scrollTop / eMax;
      const pMax = previewBody.scrollHeight - previewBody.clientHeight;
      if (pMax > 0) previewBody.scrollTop = ratio * pMax;
    };

    const onPreviewScroll = () => {
      if (activeSource !== "preview" || !editorScroller || !previewBody) return;
      const pMax = previewBody.scrollHeight - previewBody.clientHeight;
      if (pMax <= 0) return;
      const ratio = previewBody.scrollTop / pMax;
      const eMax = editorScroller.scrollHeight - editorScroller.clientHeight;
      if (eMax > 0) editorScroller.scrollTop = ratio * eMax;
    };

    (async () => {
      await tick();
      if (cleaned) return;
      editorScroller = document.querySelector(".editor-pane .cm-scroller");
      previewBody = document.querySelector(".preview-pane .pane-body");
      if (!editorScroller || !previewBody) return;
      editorScroller.addEventListener("pointerenter", onEditorEnter);
      previewBody.addEventListener("pointerenter", onPreviewEnter);
      editorScroller.addEventListener("scroll", onEditorScroll, { passive: true });
      previewBody.addEventListener("scroll", onPreviewScroll, { passive: true });
    })();

    return () => {
      cleaned = true;
      if (editorScroller) {
        editorScroller.removeEventListener("pointerenter", onEditorEnter);
        editorScroller.removeEventListener("scroll", onEditorScroll);
      }
      if (previewBody) {
        previewBody.removeEventListener("pointerenter", onPreviewEnter);
        previewBody.removeEventListener("scroll", onPreviewScroll);
      }
    };
  });

  onMount(() => {
    restorePaneState();
    restoreLastVault();
  });
</script>

<div class="app">
  <header class="topbar">
    <span class="brand">Lapis</span>
    <span class="phase">Phase 1.1 — Vault Reader</span>
    <span class="meta">
      {#if $currentNotePath}
        {noteDisplayName($currentNotePath)}
      {:else if $vaultPath}
        노트를 선택하세요
      {:else}
        Welcome
      {/if}
    </span>
  </header>

  <div
    class="workspace"
    class:editor-collapsed={$editorCollapsed}
    class:preview-collapsed={$previewCollapsed}
  >
    <Sidebar />

    <section class="pane editor-pane" class:collapsed={$editorCollapsed}>
      {#if $editorCollapsed}
        <button
          class="collapsed-strip"
          onclick={toggleEditor}
          title="에디터 펼치기"
          aria-label="에디터 펼치기"
        >
          <span class="strip-icon">▶</span>
          <span class="strip-label">Editor</span>
        </button>
      {:else}
        <div class="pane-title">
          <span>Editor (read-only)</span>
          <div class="pane-actions">
            <button
              class="copy-btn"
              class:done={editorCopied}
              title="마크다운 원본 전체 복사"
              onclick={copyEditor}
            >
              {editorCopied ? "✓ 복사됨" : "📋 마크다운 복사"}
            </button>
            {#if !$previewCollapsed}
              <button
                class="collapse-btn"
                title="에디터 접기"
                aria-label="에디터 접기"
                onclick={toggleEditor}
              >
                ◀
              </button>
            {/if}
          </div>
        </div>
        <div class="pane-body">
          <Editor bind:value={raw} />
        </div>
      {/if}
    </section>

    <section class="pane preview-pane" class:collapsed={$previewCollapsed}>
      {#if $previewCollapsed}
        <button
          class="collapsed-strip"
          onclick={togglePreview}
          title="프리뷰 펼치기"
          aria-label="프리뷰 펼치기"
        >
          <span class="strip-icon">◀</span>
          <span class="strip-label">Preview</span>
        </button>
      {:else}
        <div class="pane-title">
          <span>Preview</span>
          <div class="pane-actions">
            <button
              class="copy-btn"
              class:done={previewCopied}
              title="리치 텍스트로 복사 (Confluence·메일 등 서식 유지)"
              onclick={copyPreview}
            >
              {previewCopied ? "✓ 복사됨" : "📋 리치 텍스트 복사"}
            </button>
            {#if !$editorCollapsed}
              <button
                class="collapse-btn"
                title="프리뷰 접기"
                aria-label="프리뷰 접기"
                onclick={togglePreview}
              >
                ▶
              </button>
            {/if}
          </div>
        </div>
        <div class="pane-body">
        {#if Object.keys(parsed.data).length > 0}
          <details class="properties" open>
            <summary>Properties ({Object.keys(parsed.data).length})</summary>
            <table>
              <tbody>
                {#each Object.entries(parsed.data) as [key, value]}
                  <tr>
                    <th>{key}</th>
                    <td>
                      {#if Array.isArray(value)}
                        {#each value as v}
                          <span class="chip">{v}</span>
                        {/each}
                      {:else if typeof value === "object" && value !== null}
                        <code>{JSON.stringify(value)}</code>
                      {:else}
                        {value}
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </details>
        {/if}
        <article class="rendered">
          {@html parsed.html}
        </article>
      </div>
      {/if}
    </section>
  </div>
</div>

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    height: 100vh;
    overflow: hidden;
    background: #1e1e1e;
    color: #e8e8e8;
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", "Apple SD Gothic Neo", sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  .topbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid #333;
    background: #252526;
    font-size: 13px;
  }

  .brand {
    font-weight: 700;
    letter-spacing: 0.04em;
    color: #6dd6ff;
  }

  .phase {
    color: #aaa;
  }

  .meta {
    margin-left: auto;
    color: #777;
    font-size: 12px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    max-width: 50%;
  }

  .workspace {
    flex: 1;
    display: grid;
    grid-template-columns: 240px 1fr 1fr;
    overflow: hidden;
    transition: grid-template-columns 0.18s ease;
  }

  .workspace.editor-collapsed {
    grid-template-columns: 240px 36px 1fr;
  }

  .workspace.preview-collapsed {
    grid-template-columns: 240px 1fr 36px;
  }

  .pane {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-right: 1px solid #333;
  }

  .pane:last-child {
    border-right: none;
  }

  .pane-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 8px 4px 14px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #888;
    background: #2a2a2a;
    border-bottom: 1px solid #333;
    min-height: 30px;
  }

  .copy-btn {
    padding: 3px 10px;
    font-size: 11px;
    background: #2a2a2a;
    border: 1px solid #444;
    color: #ccc;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    text-transform: none;
    letter-spacing: normal;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }

  .copy-btn:hover {
    background: #333;
    border-color: #6dd6ff;
    color: #fff;
  }

  .copy-btn.done {
    background: #1f3a2a;
    border-color: #4caf7d;
    color: #8ee5b1;
  }

  .pane-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .collapse-btn {
    width: 26px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    font-size: 11px;
    background: #2a2a2a;
    border: 1px solid #444;
    color: #ccc;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    text-transform: none;
    letter-spacing: normal;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }

  .collapse-btn:hover {
    background: #333;
    border-color: #6dd6ff;
    color: #fff;
  }

  /* 접힌 pane의 세로 띠 — 클릭하면 다시 펼침 */
  .pane.collapsed {
    border-right: 1px solid #333;
  }

  .pane.collapsed:last-child {
    border-right: none;
    border-left: 1px solid #333;
  }

  .collapsed-strip {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 12px;
    padding: 14px 0;
    background: #2a2a2a;
    border: none;
    color: #888;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.15s, color 0.15s;
  }

  .collapsed-strip:hover {
    background: #333;
    color: #6dd6ff;
  }

  .strip-icon {
    font-size: 13px;
    line-height: 1;
  }

  .strip-label {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    user-select: none;
  }

  .pane-body {
    flex: 1;
    overflow: auto;
  }

  .preview-pane .pane-body {
    padding: 20px 28px;
  }

  .properties {
    background: #252526;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    padding: 8px 12px;
    margin-bottom: 24px;
  }

  .properties summary {
    cursor: pointer;
    color: #6dd6ff;
    font-weight: 600;
    font-size: 13px;
    user-select: none;
  }

  .properties table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
    font-size: 13px;
  }

  .properties th {
    text-align: left;
    color: #888;
    padding: 4px 12px 4px 0;
    font-weight: 500;
    width: 110px;
    vertical-align: top;
  }

  .properties td {
    padding: 4px 0;
    color: #ddd;
  }

  .chip {
    display: inline-block;
    padding: 1px 8px;
    margin: 2px 4px 2px 0;
    background: #2d4a5a;
    border-radius: 10px;
    font-size: 12px;
    color: #9adff7;
  }

  .rendered {
    line-height: 1.65;
    font-size: 15px;
  }

  .rendered :global(h1) {
    font-size: 1.8em;
    border-bottom: 1px solid #333;
    padding-bottom: 6px;
    margin-top: 0;
  }

  .rendered :global(h2) {
    font-size: 1.35em;
    margin-top: 1.6em;
    color: #e8e8e8;
  }

  .rendered :global(h3) {
    font-size: 1.1em;
    color: #ccc;
  }

  .rendered :global(a) {
    color: #6dd6ff;
  }

  .rendered :global(code) {
    background: #2d2d2d;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 0.9em;
    color: #f0a;
  }

  .rendered :global(pre) {
    background: #161616;
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
    border: 1px solid #2a2a2a;
  }

  .rendered :global(pre code) {
    background: transparent;
    color: #e8e8e8;
    padding: 0;
  }

  .rendered :global(blockquote) {
    border-left: 3px solid #6dd6ff;
    margin: 1em 0;
    padding: 0 14px;
    color: #bbb;
  }

  .rendered :global(table) {
    border-collapse: collapse;
    margin: 1em 0;
  }

  .rendered :global(th),
  .rendered :global(td) {
    border: 1px solid #3a3a3a;
    padding: 6px 12px;
  }

  .rendered :global(th) {
    background: #2a2a2a;
  }

  .rendered :global(ul),
  .rendered :global(ol) {
    padding-left: 1.5em;
  }

  .rendered :global(li) {
    margin: 0.2em 0;
  }
</style>
