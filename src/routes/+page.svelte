<script lang="ts">
  import { onMount, tick } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import Editor from "$lib/Editor.svelte";
  import Sidebar from "$lib/Sidebar.svelte";
  import CommandPalette from "$lib/CommandPalette.svelte";
  import GraphModal from "$lib/GraphModal.svelte";
  import ContextMenu from "$lib/ContextMenu.svelte";
  import NewNoteModal from "$lib/NewNoteModal.svelte";
  import Backlinks from "$lib/Backlinks.svelte";
  import Properties from "$lib/Properties.svelte";
  import { parseNote } from "$lib/markdown";
  import { paletteOpen, openPalette, closePalette } from "$lib/stores/palette";
  import { peekLastClosed } from "$lib/stores/recent";
  import { openGraph } from "$lib/stores/graph";
  import { openNewNote } from "$lib/stores/tree-ui";
  import {
    vaultPath,
    currentNotePath,
    linkIndex,
    restoreLastVault,
    selectNote,
    jumpToWikilink,
  } from "$lib/stores/vault";
  import {
    editorContent,
    isDirty,
    isSaving,
    lastSaveError,
    noteContentChanged,
    saveCurrentNote,
    markSaved,
  } from "$lib/stores/editor";
  import {
    watcherStatus,
    externalConflict,
    resolveConflictAcceptExternal,
    resolveConflictKeepLocal,
  } from "$lib/stores/watcher";
  import {
    editorCollapsed,
    previewCollapsed,
    sidebarWidth,
    setSidebarWidth,
    resetSidebarWidth,
    toggleEditor,
    togglePreview,
    restorePaneState,
  } from "$lib/stores/layout";
  import { get } from "svelte/store";
  import { getBacklinks, resolveTarget } from "$lib/linkIndex";
  import { renderMermaidIn } from "$lib/mermaid-runtime";
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

- \`/Users/Shared/Source/SharedDocs/Lysn_Epic\` — 기존 306개+ 노트 vault
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

  // vault 미선택 상태에서만 SAMPLE 사용. 노트 선택 후엔 editor store가 진실의 원천.
  // vault 있고 노트 미선택 (예: 삭제 후 / 초기 상태) → 빈 placeholder
  const EMPTY_NOTE_PLACEHOLDER = `# 노트를 선택하세요\n\n좌측 사이드바에서 노트를 클릭하거나, **Cmd+N**으로 새 노트를 만드세요.`;

  let raw = $state(SAMPLE);

  $effect(() => {
    if ($currentNotePath) {
      // editor store가 노트 콘텐츠를 보유 — 노트 변경 시 markSaved로 갱신됨
      const content = $editorContent;
      if (raw !== content) raw = content;
    } else if ($vaultPath) {
      // vault 있음 + 노트 미선택 → placeholder
      if (raw !== EMPTY_NOTE_PLACEHOLDER) {
        raw = EMPTY_NOTE_PLACEHOLDER;
        markSaved(EMPTY_NOTE_PLACEHOLDER);
      }
    } else {
      // vault 미선택 → welcome
      if (raw !== SAMPLE) {
        raw = SAMPLE;
        markSaved(SAMPLE);
      }
    }
  });

  // Editor onChange로 들어오는 사용자 입력 → store에 위임 (dirty + autosave)
  function handleEditorChange(next: string) {
    if (!$currentNotePath) {
      // SAMPLE 편집은 무시 (저장 대상 없음)
      return;
    }
    noteContentChanged(next);
  }

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

  // 현재 노트 자체의 LinkInfo — Backlinks 컴포넌트가 stem/title/alias 매칭용으로 사용
  const currentNoteInfo = $derived.by<LinkInfo | null>(() => {
    const idx = $linkIndex;
    const path = $currentNotePath;
    if (!idx || !path) return null;
    return idx.byPath.get(path) ?? null;
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

  // Preview 갱신 시 mermaid 코드블록 렌더 (lazy + dynamic import) — Phase 4.4.a
  $effect(() => {
    const _html = parsed.html;
    if (!previewBodyEl) return;
    tick().then(() => {
      if (!previewBodyEl) return;
      renderMermaidIn(previewBodyEl);
    });
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

  // 사이드바 폭 리사이저 — mousedown → 전역 mousemove/mouseup으로 드래그.
  // 더블클릭은 기본값(260) 복원.
  function startSidebarResize(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = get(sidebarWidth);
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      setSidebarWidth(startW + (ev.clientX - startX));
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // 전역 키보드 단축키
  // - Cmd/Ctrl+K            : 통합 명령 팔레트 (toggle) — Phase 4.5
  // - Cmd/Ctrl+P            : Quick Switcher (파일 그룹만 — 호환)
  // - Cmd/Ctrl+Shift+F (또는 P): 풀텍스트 (Content 그룹만 — 호환)
  // - Cmd/Ctrl+Shift+T      : 직전 노트 다시 열기 (Phase 4.5.b)
  // 모달이 이미 열려 있을 때는 CommandPalette 내부 핸들러가 ESC/화살표 등 처리
  function handleGlobalKey(e: KeyboardEvent) {
    const isMod = e.metaKey || e.ctrlKey;
    if (!isMod) return;
    const key = e.key.toLowerCase();
    if (key === "k" && !e.shiftKey) {
      e.preventDefault();
      if ($paletteOpen) closePalette();
      else openPalette("all");
    } else if (key === "p" && !e.shiftKey) {
      e.preventDefault();
      openPalette("files");
    } else if ((key === "f" && e.shiftKey) || (key === "p" && e.shiftKey)) {
      e.preventDefault();
      openPalette("fulltext");
    } else if (key === "t" && e.shiftKey) {
      e.preventDefault();
      const path = peekLastClosed();
      if (path && path !== $currentNotePath) void selectNote(path);
    } else if (key === "g" && !e.shiftKey) {
      e.preventDefault();
      openGraph();
    } else if (key === "s" && !e.shiftKey) {
      e.preventDefault();
      void saveCurrentNote();
    } else if (key === "n" && !e.shiftKey) {
      // Cmd+N — 새 노트. 현재 노트의 부모 폴더 또는 vault root에 생성.
      e.preventDefault();
      if (!$vaultPath) return;
      const cur = $currentNotePath;
      const parentDir = cur
        ? cur.split("/").slice(0, -1).join("/")
        : $vaultPath;
      const parentLabel = cur
        ? (cur.split("/").slice(-2, -1)[0] ?? "") + "/"
        : "(vault root)";
      openNewNote(parentDir, parentLabel);
    }
  }

  onMount(() => {
    restorePaneState();
    restoreLastVault();
  });
</script>

<svelte:window onkeydown={handleGlobalKey} />

<CommandPalette />
<GraphModal />
<ContextMenu />
<NewNoteModal />

{#if $externalConflict}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="conflict-backdrop" onclick={(e) => e.target === e.currentTarget && resolveConflictKeepLocal()}>
    <div class="conflict-modal" role="dialog" aria-modal="true">
      <header class="conflict-head">
        <span class="conflict-icon">⚠</span>
        <span>외부에서 노트가 변경되었습니다</span>
      </header>
      <div class="conflict-body">
        <p>이 노트를 다른 도구에서 수정한 것 같습니다. 동시에 Lapis에서도 편집 중입니다 (저장되지 않은 변경 있음).</p>
        <p class="path">{$externalConflict.path}</p>
        <p class="hint">어떻게 처리할까요?</p>
      </div>
      <footer class="conflict-foot">
        <button class="btn keep" onclick={resolveConflictKeepLocal}>
          내 변경 유지
          <span class="hint">다음 저장 시 외부 변경을 덮어씁니다</span>
        </button>
        <button class="btn accept" onclick={resolveConflictAcceptExternal}>
          외부 변경 사용
          <span class="hint">현재 편집 중인 내용을 폐기하고 외부 버전 로드</span>
        </button>
      </footer>
    </div>
  </div>
{/if}

<div class="app">
  <header class="topbar">
    <span class="brand">Lapis</span>
    <span class="phase">Phase 2.0 — Editable Vault</span>
    <span class="meta">
      {#if $currentNotePath}
        {noteDisplayName($currentNotePath)}
        {#if $isSaving}
          <span class="save-badge saving">saving…</span>
        {:else if $lastSaveError}
          <span class="save-badge error" title={$lastSaveError}>save failed</span>
        {:else if $isDirty}
          <span class="save-badge dirty" title="저장되지 않음 (자동 저장 2초 / Cmd+S)">● modified</span>
        {/if}
      {:else if $vaultPath}
        노트를 선택하세요
      {:else}
        Welcome
      {/if}
    </span>
    <div class="topbar-actions">
      <span
        class="watcher-dot"
        class:watching={$watcherStatus === "watching"}
        class:error={$watcherStatus === "error"}
        title={$watcherStatus === "watching"
          ? "외부 변경 감시 중"
          : $watcherStatus === "error"
            ? "Watcher 오류 — 외부 변경 자동 감지 불가"
            : "Watcher 대기"}
      ></span>
      <button
        class="topbar-btn"
        title="Command palette (Cmd+K)"
        onclick={() => openPalette("all")}
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
    style="--sidebar-w: {$sidebarWidth}px"
  >
    <Sidebar />
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="사이드바 폭 조절 (더블클릭으로 기본값 복원)"
      title="드래그로 폭 조절 · 더블클릭으로 복원"
      onmousedown={startSidebarResize}
      ondblclick={resetSidebarWidth}
    ></div>

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
          <span>Editor</span>
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
          <Editor bind:value={raw} onChange={handleEditorChange} />
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
        <Properties data={effectiveProperties} isAuto={propertiesAuto} rawNote={raw} />
        <article class="rendered">
          {@html parsed.html}
        </article>

        {#if $currentNotePath}
          <Backlinks targetNote={currentNoteInfo} backlinks={currentBacklinks} />
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
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .save-badge {
    font-size: 11px;
    padding: 2px 7px;
    border-radius: 10px;
    font-weight: 500;
    flex-shrink: 0;
  }

  .save-badge.dirty {
    color: #f7c947;
    background: rgba(247, 201, 71, 0.12);
    border: 1px solid rgba(247, 201, 71, 0.3);
  }

  .save-badge.saving {
    color: #6dd6ff;
    background: rgba(109, 214, 255, 0.12);
    border: 1px solid rgba(109, 214, 255, 0.3);
  }

  .save-badge.error {
    color: #f47174;
    background: rgba(244, 113, 116, 0.12);
    border: 1px solid rgba(244, 113, 116, 0.4);
  }

  /* 외부 변경 충돌 다이얼로그 */
  .conflict-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
    padding: 32px;
  }

  .conflict-modal {
    width: min(520px, 92vw);
    background: #1f1f1f;
    border: 1px solid #4a3a3a;
    border-radius: 10px;
    overflow: hidden;
    color: #e8e8e8;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
  }

  .conflict-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px;
    background: #2d1f1f;
    border-bottom: 1px solid #4a3a3a;
    font-weight: 600;
    color: #f7c8c8;
  }

  .conflict-icon {
    font-size: 18px;
    color: #f47174;
  }

  .conflict-body {
    padding: 16px 18px;
    line-height: 1.6;
    font-size: 14px;
    color: #ddd;
  }

  .conflict-body .path {
    margin: 8px 0;
    padding: 6px 10px;
    background: #2a2a2a;
    border-radius: 4px;
    font-family: "SF Mono", Menlo, Consolas, monospace;
    font-size: 12px;
    color: #aaa;
    word-break: break-all;
  }

  .conflict-body .hint {
    color: #aaa;
    margin-top: 12px;
  }

  .conflict-foot {
    display: flex;
    gap: 8px;
    padding: 12px 14px;
    background: #252526;
    border-top: 1px solid #4a3a3a;
  }

  .conflict-foot .btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 12px;
    background: #2a2a2a;
    border: 1px solid #444;
    color: #ddd;
    border-radius: 6px;
    cursor: pointer;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    transition: background 0.1s, border-color 0.1s, color 0.1s;
  }

  .conflict-foot .btn:hover {
    background: #333;
  }

  .conflict-foot .btn.keep {
    border-color: #f7c947;
    color: #f7c947;
  }
  .conflict-foot .btn.keep:hover {
    background: rgba(247, 201, 71, 0.1);
  }

  .conflict-foot .btn.accept {
    border-color: #6dd6ff;
    color: #6dd6ff;
  }
  .conflict-foot .btn.accept:hover {
    background: rgba(109, 214, 255, 0.1);
  }

  .conflict-foot .btn .hint {
    font-size: 10px;
    font-weight: 400;
    color: #777;
  }

  .topbar-actions {
    display: flex;
    gap: 4px;
    margin-left: 8px;
    align-items: center;
  }

  .watcher-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #555;
    margin-right: 4px;
    transition: background 0.2s, box-shadow 0.2s;
  }

  .watcher-dot.watching {
    background: #6dd6a4;
    box-shadow: 0 0 6px rgba(109, 214, 164, 0.5);
  }

  .watcher-dot.error {
    background: #f47174;
    box-shadow: 0 0 6px rgba(244, 113, 116, 0.5);
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
    grid-template-columns: var(--sidebar-w, 260px) 4px 1fr 1fr;
    overflow: hidden;
    transition: grid-template-columns 0.18s ease;
  }

  .workspace.editor-collapsed {
    grid-template-columns: var(--sidebar-w, 260px) 4px 36px 1fr;
  }

  .workspace.preview-collapsed {
    grid-template-columns: var(--sidebar-w, 260px) 4px 1fr 36px;
  }

  .sidebar-resizer {
    background: transparent;
    cursor: ew-resize;
    position: relative;
    z-index: 5;
    transition: background 0.12s;
  }

  .sidebar-resizer:hover,
  .sidebar-resizer:active {
    background: #6dd6ff;
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

  /* Properties 패널 CSS는 src/lib/Properties.svelte로 이전 (Phase 4.3.a) */

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

  /* Mermaid 다이어그램 호스트 (Phase 4.4.a) */
  .rendered :global(.mermaid-host) {
    margin: 1em 0;
    text-align: center;
  }

  .rendered :global(.mermaid-host[data-rendered="pending"]) {
    min-height: 80px;
    background: #1a1a1a;
    border-radius: 4px;
  }

  .rendered :global(.mermaid-host svg) {
    max-width: 100%;
    height: auto;
  }

  .rendered :global(.mermaid-error) {
    background: rgba(244, 113, 116, 0.08);
    border: 1px solid rgba(244, 113, 116, 0.4);
    color: #f47174;
    padding: 12px;
    border-radius: 4px;
    white-space: pre-wrap;
    text-align: left;
    font-size: 12px;
    line-height: 1.5;
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

  /* 백링크 패널 CSS는 src/lib/Backlinks.svelte로 이전 (Phase 4.5.c) */
</style>
