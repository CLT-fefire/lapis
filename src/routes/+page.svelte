<script lang="ts">
  import { onMount, tick } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import Editor from "$lib/Editor.svelte";
  import Sidebar from "$lib/Sidebar.svelte";
  import SearchModal from "$lib/SearchModal.svelte";
  import GraphModal from "$lib/GraphModal.svelte";
  import { parseNote } from "$lib/markdown";
  import { openSearch, searchOpen } from "$lib/stores/search";
  import { selectTag, showTagsTab } from "$lib/stores/tags";
  import { openGraph } from "$lib/stores/graph";
  import {
    vaultPath,
    currentNotePath,
    currentNoteContent,
    linkIndex,
    restoreLastVault,
    selectNote,
    jumpToWikilink,
  } from "$lib/stores/vault";
  import {
    editorCollapsed,
    previewCollapsed,
    toggleEditor,
    togglePreview,
    restorePaneState,
  } from "$lib/stores/layout";
  import { getBacklinks, resolveTarget } from "$lib/linkIndex";
  import type { LinkInfo } from "$lib/tauri/notes";

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

## Phase 1.2에서 새로 가능한 것

- Wikilink 인식 + 클릭 점프 — 예: \`[[STATE]]\`, \`[[PLAN]]\`
  (실제 vault에 해당 이름 노트가 있으면 시안색, 없으면 빨간 점선)
- 백링크 패널 — Preview 하단에 이 노트를 가리키는 노트 목록

## 아직 안 되는 것

- 편집 후 저장 (Phase 2)
- 외부 변경 자동 감지 (Phase 2)
- 검색 / Quick Switcher (Phase 1.3)
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

  // 현재 노트의 백링크 (다른 노트에서 이 노트를 [[wikilink]]로 가리키는 항목들)
  const currentBacklinks = $derived.by<LinkInfo[]>(() => {
    const idx = $linkIndex;
    const path = $currentNotePath;
    if (!idx || !path) return [];
    return getBacklinks(path, idx);
  });

  // Properties: frontmatter 있으면 그대로, 없으면 합성 정보(file/path/tags/backlinks).
  const effectiveProperties = $derived.by<Record<string, unknown>>(() => {
    if (Object.keys(parsed.data).length > 0) return parsed.data;

    const path = $currentNotePath;
    if (!path) return {};

    const synthetic: Record<string, unknown> = {};
    const segs = path.split("/").filter(Boolean);
    synthetic.file = segs[segs.length - 1] ?? path;
    if (segs.length > 1) {
      synthetic.path = segs.slice(-3, -1).join("/");
    }

    const idx = $linkIndex;
    const info = idx?.byPath.get(path);
    if (info && info.tags.length > 0) {
      synthetic.tags = info.tags;
    }

    if (currentBacklinks.length > 0) {
      synthetic.backlinks = currentBacklinks.length;
    }

    return synthetic;
  });

  const propertiesAuto = $derived(Object.keys(parsed.data).length === 0);

  // Preview 안의 모든 클릭을 가로채서 분기 처리 (event delegation)
  // - .wikilink: 내부 노트 점프
  // - <a href="http..."> 외부: 시스템 브라우저로 (Tauri opener)
  // - <a href="..."> 내부 (./, ../, *.md, 상대 경로): 노트 점프 시도
  // - 그 외: SvelteKit SPA navigation 절대 막음 (앱이 /파일명 으로 가서 404 화이트스크린 되는 사고 방지)
  async function handlePreviewClick(e: MouseEvent) {
    const el = e.target as HTMLElement | null;
    if (!el) return;

    // 1) wikilink (span)
    const wikilink = el.closest(".wikilink") as HTMLElement | null;
    if (wikilink) {
      e.preventDefault();
      const target = wikilink.getAttribute("data-target");
      if (target) {
        const ok = await jumpToWikilink(target);
        if (!ok) console.info("wikilink unresolved:", target);
      }
      return;
    }

    // 2) 일반 <a> 태그 — markdown 링크 [텍스트](경로)
    const anchor = el.closest("a") as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";

    // 외부 링크 → 시스템 브라우저
    if (/^(https?:|mailto:|tel:)/i.test(href)) {
      e.preventDefault();
      try {
        await openUrl(href);
      } catch (err) {
        console.error("openUrl failed", err);
      }
      return;
    }

    // 빈 href / # / 내부 경로 → SPA 라우팅 차단
    e.preventDefault();
    if (!href || href === "#") return;

    // .md 확장자나 상대 경로 → wikilink 매칭 시도 (확장자 제거 + 마지막 segment)
    const cleaned = href
      .replace(/^\.\//, "")
      .replace(/^\//, "")
      .replace(/\.md$/i, "");
    const lastSegment = cleaned.split("/").pop() ?? cleaned;
    const ok = await jumpToWikilink(lastSegment);
    if (!ok) console.info("note link unresolved:", href);
  }

  // Preview 렌더 후 wikilink에 resolved/unresolved 클래스 부여 (인덱스 기반)
  let previewBodyEl: HTMLElement | null = $state(null);
  $effect(() => {
    const _html = parsed.html;
    const idx = $linkIndex;
    if (!previewBodyEl) return;
    (async () => {
      await tick();
      if (!previewBodyEl) return;
      const links = previewBodyEl.querySelectorAll<HTMLElement>(".wikilink");
      for (const a of links) {
        const target = a.getAttribute("data-target");
        const resolved = idx && target ? !!resolveTarget(target, idx) : false;
        a.classList.toggle("resolved", resolved);
        a.classList.toggle("unresolved", !resolved);
      }
    })();
  });

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

  // 전역 키보드 단축키
  // - Cmd/Ctrl+P            : Quick Switcher (파일명/alias/title)
  // - Cmd/Ctrl+Shift+F (또는 P): 풀텍스트 검색
  // 모달이 이미 열려 있을 때는 SearchModal 내부 핸들러가 ESC/화살표 등 처리
  function handleGlobalKey(e: KeyboardEvent) {
    const isMod = e.metaKey || e.ctrlKey;
    if (!isMod) return;
    const key = e.key.toLowerCase();
    if (key === "p" && !e.shiftKey) {
      e.preventDefault();
      openSearch("files");
    } else if ((key === "f" && e.shiftKey) || (key === "p" && e.shiftKey)) {
      e.preventDefault();
      openSearch("fulltext");
    } else if (key === "g" && !e.shiftKey) {
      e.preventDefault();
      openGraph();
    }
  }

  onMount(() => {
    restorePaneState();
    restoreLastVault();
  });
</script>

<svelte:window onkeydown={handleGlobalKey} />

<SearchModal />
<GraphModal />

<div class="app">
  <header class="topbar">
    <span class="brand">Lapis</span>
    <span class="phase">Phase 1.3 — Search</span>
    <span class="meta">
      {#if $currentNotePath}
        {noteDisplayName($currentNotePath)}
      {:else if $vaultPath}
        노트를 선택하세요
      {:else}
        Welcome
      {/if}
    </span>
    <div class="topbar-actions">
      <button
        class="topbar-btn"
        title="Quick Switcher (Cmd+P)"
        onclick={() => openSearch("files")}
      >🔎</button>
      <button
        class="topbar-btn"
        title="Graph view (Cmd+G)"
        onclick={openGraph}
      >🕸</button>
    </div>
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
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="pane-body" bind:this={previewBodyEl} onclick={handlePreviewClick}>
        {#if Object.keys(effectiveProperties).length > 0}
          <details class="properties" open>
            <summary>
              Properties ({Object.keys(effectiveProperties).length}){#if propertiesAuto}<span class="auto-tag">· auto</span>{/if}
            </summary>
            <table>
              <tbody>
                {#each Object.entries(effectiveProperties) as [key, value]}
                  <tr>
                    <th>{key}</th>
                    <td>
                      {#if Array.isArray(value)}
                        {#each value as v}
                          {#if key === "tags"}
                            <button
                              class="chip chip-tag"
                              title="이 태그로 사이드바 필터"
                              onclick={() => { selectTag(String(v)); showTagsTab(); }}
                            >#{v}</button>
                          {:else}
                            <span class="chip">{v}</span>
                          {/if}
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

        {#if $currentNotePath && currentBacklinks.length > 0}
          <section class="backlinks">
            <h3>↰ Backlinks · {currentBacklinks.length}</h3>
            <ul>
              {#each currentBacklinks as bl (bl.source_path)}
                <li>
                  <button
                    class="backlink"
                    title={bl.source_path}
                    onclick={() => selectNote(bl.source_path)}
                  >
                    {bl.title ?? bl.source_name}
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
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
    max-width: 40%;
  }

  .topbar-actions {
    display: flex;
    gap: 4px;
    margin-left: 8px;
  }

  .topbar-btn {
    width: 28px;
    height: 24px;
    background: #2a2a2a;
    border: 1px solid #444;
    color: #ccc;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: 13px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    transition: background 0.1s, border-color 0.1s, color 0.1s;
  }

  .topbar-btn:hover {
    background: #333;
    border-color: #6dd6ff;
    color: #fff;
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

  .auto-tag {
    margin-left: 6px;
    color: #888;
    font-weight: 400;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
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

  .chip-tag {
    border: 1px solid transparent;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.1s, border-color 0.1s, color 0.1s;
  }

  .chip-tag:hover {
    background: #355a6e;
    color: #fff;
    border-color: #6dd6ff;
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

  /* Wikilink 스타일 (span 기반 — 안전한 navigation) */
  .rendered :global(.wikilink) {
    color: #6dd6ff;
    text-decoration: none;
    border-bottom: 1px dashed rgba(109, 214, 255, 0.6);
    cursor: pointer;
    padding: 0 1px;
    border-radius: 2px;
    transition: background 0.1s;
  }

  .rendered :global(.wikilink:hover) {
    background: rgba(109, 214, 255, 0.12);
  }

  .rendered :global(.wikilink:focus-visible) {
    outline: 2px solid #6dd6ff;
    outline-offset: 1px;
  }

  .rendered :global(.wikilink.unresolved) {
    color: #f47174;
    border-bottom-color: rgba(244, 113, 116, 0.6);
    border-bottom-style: dotted;
  }

  .rendered :global(.wikilink.unresolved:hover) {
    background: rgba(244, 113, 116, 0.12);
  }

  /* 백링크 패널 */
  .backlinks {
    margin-top: 36px;
    padding-top: 18px;
    border-top: 1px solid #333;
  }

  .backlinks h3 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #888;
    margin: 0 0 10px 0;
    font-weight: 600;
  }

  .backlinks ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .backlinks li {
    margin: 0;
  }

  .backlink {
    background: transparent;
    border: 1px solid #2d4a5a;
    color: #6dd6ff;
    padding: 4px 12px;
    border-radius: 14px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .backlink:hover {
    background: #2d4a5a;
    color: #fff;
    border-color: #6dd6ff;
  }
</style>
