<script lang="ts">
  import { onMount, tick } from "svelte";
  // 렌더된 본문 스타일 — HTML 내보내기와 공유하는 단일 진실 위치. 전역으로 주입된다.
  import "$lib/styles/rendered.css";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { getVersion } from "@tauri-apps/api/app";
  import Editor from "$lib/Editor.svelte";
  import Sidebar from "$lib/Sidebar.svelte";
  import SidebarRail from "$lib/SidebarRail.svelte";
  import GitBanner from "$lib/GitBanner.svelte";
  import CommandPalette from "$lib/CommandPalette.svelte";
  import LinkRewritePreviewModal from "$lib/LinkRewritePreviewModal.svelte";
  import ContextMenu from "$lib/ContextMenu.svelte";
  import NewNoteModal from "$lib/NewNoteModal.svelte";
  import SettingsModal from "$lib/SettingsModal.svelte";
  import NavHistoryMenu from "$lib/NavHistoryMenu.svelte";
  import TabBar from "$lib/TabBar.svelte";
  import GraphModal from "$lib/GraphModal.svelte";
  import ReadingControls from "$lib/ReadingControls.svelte";
  import PaneMenu, { type PaneMenuItem } from "$lib/PaneMenu.svelte";
  import { revealInFinder } from "$lib/tauri/reveal";
  import { exportPreviewToHtml } from "$lib/previewExport";
  import { readingFontSize, readingMeasureLimited } from "$lib/stores/reading";
  import { restoreSettings } from "$lib/stores/settings";
  import { requestRename } from "$lib/stores/tree-ui";
  import { parseNote } from "$lib/markdown";
  import { computeTextStats, readingTimeLabel } from "$lib/textStats";
  import { showOutlineTab } from "$lib/stores/tags";
  import {
    outlineHeadings,
    activeHeadingSlug,
    headingJumpRequest,
  } from "$lib/stores/outline";
  import { paletteOpen, openPalette, closePalette } from "$lib/stores/palette";
  import { openGraph, GRAPH_FEATURE_ENABLED } from "$lib/stores/graph";
  import { peekLastClosed } from "$lib/stores/recent";
  import { openNewNote } from "$lib/stores/tree-ui";
  import {
    vaultPath,
    currentNotePath,
    linkIndex,
    restoreLastVault,
    selectNote,
    jumpToWikilink,
    deletePath,
    goBackNote,
    goForwardNote,
    closeTab,
  } from "$lib/stores/vault";
  import { canGoBack, canGoForward } from "$lib/stores/navHistory";
  import { openTabs, tabPathForShortcut } from "$lib/stores/tabs";
  import { noteDisplayName } from "$lib/notePath";
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
    sidebarCollapsed,
    sidebarWidth,
    setSidebarWidth,
    resetSidebarWidth,
    toggleEditor,
    togglePreview,
    toggleSidebar,
    restorePaneState,
    contextCollapsed,
    contextWidth,
    setContextWidth,
    resetContextWidth,
    toggleContext,
  } from "$lib/stores/layout";
  import ContextPanel from "$lib/ContextPanel.svelte";
  import { onSystemThemeChange, restoreTheme, themeMode } from "$lib/stores/theme";
  import { restoreDensity } from "$lib/stores/density";
  import { get } from "svelte/store";
  import { getBacklinks, resolveTarget } from "$lib/linkIndex";
  import { groupRelations, type RelationGroup } from "$lib/relations";
  import { renderMermaidIn, resetMermaidHosts } from "$lib/mermaid-runtime";
  import { exportMermaidHostToPng } from "$lib/mermaidExport";
  import { rewriteImageSources } from "$lib/assetPath";
  import type { LinkInfo } from "$lib/tauri/notes";
  import InDocSearchBar from "$lib/InDocSearchBar.svelte";
  import {
    inDocSearch,
    lastFocused,
    openSearch,
    closeSearch,
    setMatchInfo,
    setRegexError,
    resetSearch,
  } from "$lib/stores/inDocSearch";
  import type { InDocSearchOptions } from "$lib/stores/inDocSearch";
  import {
    findMatches,
    applyHighlights,
    clearHighlights,
    scrollCurrentMarkIntoView,
  } from "$lib/previewHighlight";
  import type { EditorApi } from "$lib/Editor.svelte";

  const SAMPLE = `---
title: Lapis 시작하기
status: welcome
tags: [welcome, getting-started]
---

# Lapis에 오신 것을 환영합니다

**Lapis**는 로컬 마크다운 파일을 백링크 · 태그 · 그래프로 항해하는 개인용 워크벤치입니다.
모든 노트는 로컬 파일시스템에만 저장되며, 외부 동기화는 일절 일어나지 않습니다.

## 시작하기

좌측 사이드바 상단의 **Vault 열기…** 버튼으로 마크다운이 들어 있는 폴더를 선택하세요.
선택 후 트리에서 노트를 클릭하면 이 영역에 본문이, 우측에 렌더링이 표시됩니다.

### 추천 vault 경로

- 개인 노트: \`~/Documents/Notes\`
- 프로젝트 문서: \`/Users/Shared/Source/<프로젝트>/docs\`
- 빈 폴더를 새로 만들어도 됩니다 — 첫 노트는 사이드바의 "Welcome 샘플 만들기" 버튼으로 만들 수 있어요.

## 핵심 단축키

| 단축키 | 동작 |
|---|---|
| \`⌘K\` | Command Palette — 모든 명령 검색 |
| \`⌘P\` | Quick File Open — 파일명 fuzzy 검색 |
| \`⌘⇧F\` | Full-text 검색 (tantivy + 한국어 형태소) |
| \`⌘F\` | 현재 노트 내 검색 |
| \`⌘N\` | 새 노트 만들기 |
| \`⌘G\` | Graph View |
| \`⌘S\` | 즉시 저장 (편집 시 2초마다 자동 저장됨) |
| \`F2\` | 현재 노트 이름 변경 *(Mac 매직 키보드 기본은 F2가 밝기 — \`Fn+F2\` 또는 키보드 설정에서 "F1, F2를 표준 기능 키로" 켜기. 안 되면 \`⌘K\` → "Rename")* |
| \`⌘⌫\` | 현재 노트 휴지통으로 |

## 자세한 가이드

설치 · 사용 · FAQ는 [팀 Confluence 페이지](https://everysing.atlassian.net/wiki/spaces/IMA/pages/4435017752/Lapis)에 정리되어 있습니다.

GitHub: <https://github.com/CLT-fefire/lapis>
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

  /**
   * `.mmd` 단일 mermaid 파일은 본문 전체를 mermaid 다이어그램으로 간주.
   * Preview만 mermaid fence로 래핑 — Editor는 raw mermaid 소스 그대로 편집.
   */
  const previewRaw = $derived.by(() => {
    const path = $currentNotePath;
    if (path && path.toLowerCase().endsWith(".mmd")) {
      return "```mermaid\n" + raw + "\n```\n";
    }
    return raw;
  });

  const parsed = $derived(parseNote(previewRaw));

  // 현재 노트 본문 통계 (단어 / 글자 / 읽기시간) — topbar 표시용.
  const docStats = $derived(computeTextStats(raw));

  // 노트 히스토리 드롭다운 열림 상태 (topbar ▾ 토글).
  let historyMenuOpen = $state(false);

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

  // Phase A-2 — 현재 노트의 frontmatter 관계 (타입별 그룹). Neighborhood 패널이 소비.
  const currentOutgoing = $derived.by<RelationGroup[]>(() => {
    const idx = $linkIndex;
    const path = $currentNotePath;
    if (!idx || !path) return [];
    return groupRelations(idx.relations.outgoing.get(path) ?? [], idx.byPath);
  });
  const currentIncoming = $derived.by<RelationGroup[]>(() => {
    const idx = $linkIndex;
    const path = $currentNotePath;
    if (!idx || !path) return [];
    return groupRelations(idx.relations.incoming.get(path) ?? [], idx.byPath);
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

    // 0) mermaid PNG 내보내기 버튼 — 반드시 anchor 체크보다 앞.
    //    <button>은 closest("a")에 안 걸려 아래 `if (!anchor) return`에서 무시됨.
    const exportBtn = el.closest(".mermaid-export-btn") as HTMLElement | null;
    if (exportBtn) {
      e.preventDefault();
      const host = exportBtn.closest(".mermaid-host") as HTMLElement | null;
      if (host) {
        const fileName = $currentNotePath?.split("/").pop() ?? "diagram";
        const base = fileName.replace(/\.(md|mmd)$/i, "");
        try {
          await exportMermaidHostToPng(host, base);
        } catch (err) {
          console.error("mermaid PNG 내보내기 실패", err);
        }
      }
      return;
    }

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

  // 테마 전환 시 mermaid 재렌더 — SVG는 테마별로 baked되어 토큰처럼 자동 적응 못 함.
  // $themeMode 변경을 추적해 렌더 가드를 풀고 현재 테마로 다시 그린다.
  $effect(() => {
    const _mode = $themeMode;
    if (!previewBodyEl) return;
    tick().then(() => {
      if (!previewBodyEl) return;
      resetMermaidHosts(previewBodyEl);
      renderMermaidIn(previewBodyEl);
    });
  });

  // "system" 모드에서 OS 외관이 런타임에 바뀌면 $themeMode는 "system" 그대로라
  // 위 effect가 안 돌고 mermaid만 stale로 남는다. matchMedia 변경을 구독해
  // 그때만 재렌더한다. (CSS는 prefers-color-scheme로 자동 적응)
  $effect(() => {
    return onSystemThemeChange(() => {
      if (!previewBodyEl) return;
      resetMermaidHosts(previewBodyEl);
      renderMermaidIn(previewBodyEl);
    });
  });

  // Preview 갱신 시 이미지 src 재작성 (상대 경로 → asset 프로토콜) — Phase 4.4.b
  $effect(() => {
    const _html = parsed.html;
    const path = $currentNotePath;
    if (!previewBodyEl || !path) return;
    tick().then(() => {
      if (!previewBodyEl) return;
      rewriteImageSources(previewBodyEl, path);
    });
  });

  // --- in-document search (Phase 5.0) ---
  let editorApi: EditorApi | undefined = $state();
  // Preview 측은 Range가 surroundContents 후 무효화되므로 매치를 캐시하지 않고
  // 매번 query 기반으로 재계산. query/total/currentIdx만 추적.
  let previewQuery = $state("");
  let previewTotal = $state(0);
  let previewCurrentIdx = $state(-1);

  function currentEditorOpts() {
    const o = get(inDocSearch).options;
    return {
      caseSensitive: o.caseSensitive,
      wholeWord: o.wholeWord,
      regex: o.regex,
    };
  }

  function editorOnQuery(q: string) {
    if (!editorApi) return;
    const info = editorApi.setQuery(q, currentEditorOpts());
    setMatchInfo(info.total, info.current);
    setRegexError(info.regexError === true);
  }
  function editorOnNext() {
    if (!editorApi) return;
    const info = editorApi.findNext();
    setMatchInfo(info.total, info.current);
    setRegexError(info.regexError === true);
  }
  function editorOnPrev() {
    if (!editorApi) return;
    const info = editorApi.findPrev();
    setMatchInfo(info.total, info.current);
    setRegexError(info.regexError === true);
  }
  function editorOnClosed() {
    editorApi?.clearQuery();
    setRegexError(false);
    editorApi?.focus();
  }
  function editorOnOptionsChanged(_: InDocSearchOptions) {
    // 같은 query로 옵션 반영해서 재검색.
    const q = get(inDocSearch).query;
    editorOnQuery(q);
  }

  // --- 문서 아웃라인(TOC) 양방향 동기 (Phase: post-v0.9.1 ①) ---
  // parsed.headings → outline 스토어 (사이드바 OutlinePanel이 구독).
  $effect(() => {
    outlineHeadings.set(parsed.headings);
  });

  // TOC 클릭 → 에디터 라인 점프 + 프리뷰 스크롤. nonce로 동일 헤딩 반복 클릭도 재발화.
  let lastJumpNonce = -1;
  $effect(() => {
    const req = $headingJumpRequest;
    if (!req || req.nonce === lastJumpNonce) return;
    lastJumpNonce = req.nonce;
    const heading = req.heading;
    if (editorApi && !get(editorCollapsed)) {
      editorApi.jumpToLine(heading.line + 1);
    }
    if (previewBodyEl && !get(previewCollapsed)) {
      const el = previewBodyEl.querySelector<HTMLElement>(
        `.rendered [id="${cssEscapeAttr(heading.slug)}"]`,
      );
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    activeHeadingSlug.set(heading.slug);
  });

  // 프리뷰 스크롤 → 활성 헤딩 하이라이트 (scroll-spy). rAF 스로틀.
  let scrollSpyScheduled = false;
  function handlePreviewScroll() {
    if (scrollSpyScheduled) return;
    scrollSpyScheduled = true;
    requestAnimationFrame(() => {
      scrollSpyScheduled = false;
      updateActiveHeading();
    });
  }
  function updateActiveHeading() {
    const container = previewBodyEl;
    if (!container) return;
    const hs = container.querySelectorAll<HTMLElement>(
      ".rendered h1[id], .rendered h2[id], .rendered h3[id], .rendered h4[id], .rendered h5[id], .rendered h6[id]",
    );
    if (hs.length === 0) {
      activeHeadingSlug.set(null);
      return;
    }
    const cTop = container.getBoundingClientRect().top;
    let active = hs[0].id;
    for (const h of hs) {
      if (h.getBoundingClientRect().top - cTop <= 8) active = h.id;
      else break;
    }
    activeHeadingSlug.set(active);
  }

  // 슬러그를 CSS 속성 선택자 값으로 안전하게 (백슬래시/따옴표 escape).
  function cssEscapeAttr(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function previewApply(query: string, currentIdx: number) {
    if (!previewBodyEl) return;
    clearHighlights(previewBodyEl);
    if (!query) {
      previewTotal = 0;
      previewCurrentIdx = -1;
      setMatchInfo(0, 0);
      setRegexError(false);
      return;
    }
    const opts = currentEditorOpts();
    // regex 모드면 패턴 사전 검증해 invalid 시 빨간 표시 + 매치 0.
    if (opts.regex) {
      try {
        new RegExp(query);
      } catch {
        previewTotal = 0;
        previewCurrentIdx = -1;
        setMatchInfo(0, 0);
        setRegexError(true);
        return;
      }
    }
    setRegexError(false);
    const matches = findMatches(previewBodyEl, query, opts);
    previewTotal = matches.length;
    if (matches.length === 0) {
      previewCurrentIdx = -1;
      setMatchInfo(0, 0);
      return;
    }
    // currentIdx 범위 보정 (wrap)
    const idx = ((currentIdx % matches.length) + matches.length) % matches.length;
    previewCurrentIdx = idx;
    applyHighlights(previewBodyEl, matches, idx);
    setMatchInfo(matches.length, idx + 1);
    scrollCurrentMarkIntoView(previewBodyEl, previewBodyEl);
  }
  function previewRecompute(query: string) {
    previewQuery = query;
    previewApply(query, 0);
  }
  function previewOnOptionsChanged(_: InDocSearchOptions) {
    previewApply(previewQuery, 0);
  }
  function previewOnNext() {
    if (previewTotal === 0) return;
    previewApply(previewQuery, previewCurrentIdx + 1);
  }
  function previewOnPrev() {
    if (previewTotal === 0) return;
    previewApply(previewQuery, previewCurrentIdx - 1);
  }
  function previewOnClosed() {
    previewQuery = "";
    previewTotal = 0;
    previewCurrentIdx = -1;
    if (previewBodyEl) clearHighlights(previewBodyEl);
  }

  // 노트 전환 시 검색 상태 리셋 + 스크롤 맨 위로
  let lastNotePath: string | null = null;
  $effect(() => {
    const path = $currentNotePath;
    if (path !== lastNotePath) {
      lastNotePath = path;
      if (get(inDocSearch).open) {
        resetSearch();
      }
      editorApi?.clearQuery();
      previewQuery = "";
      previewTotal = 0;
      previewCurrentIdx = -1;
      if (previewBodyEl) clearHighlights(previewBodyEl);

      // 다른 문서로 바꿨으니 이전 문서의 스크롤 위치를 버리고 맨 위에서 시작.
      // 새 본문이 DOM에 반영된 뒤(tick) 프리뷰·에디터 스크롤러를 모두 0으로.
      void tick().then(() => {
        if (previewBodyEl) previewBodyEl.scrollTop = 0;
        const cm = document.querySelector<HTMLElement>(".editor-pane .cm-scroller");
        if (cm) cm.scrollTop = 0;
      });
    }
  });

  // Preview 재렌더 시 mark가 다음 markdown 출력으로 덮어쓰여짐 → 검색 활성이면 재적용
  $effect(() => {
    const _html = parsed.html;
    if (!previewBodyEl) return;
    const s = get(inDocSearch);
    if (s.open && s.target === "preview" && s.query) {
      void tick().then(() => {
        if (!previewBodyEl) return;
        // 새 DOM 기준으로 mark 다시 적용. currentIdx는 0으로 리셋(노트 내용 자체가 바뀜).
        previewQuery = s.query;
        previewApply(s.query, 0);
      });
    } else {
      previewQuery = "";
      previewTotal = 0;
      previewCurrentIdx = -1;
    }
  });

  let editorCopied = $state(false);
  let previewCopied = $state(false);
  /** 경로 복사 버튼은 Editor/Preview 양쪽에 있지만 한 state 공유 — 어느 쪽을 눌러도 "✓ 복사됨"이 두 버튼에 모두 표시되어 일관 UX. */
  let pathCopied = $state(false);
  let editorCopyTimer: ReturnType<typeof setTimeout> | null = null;
  let previewCopyTimer: ReturnType<typeof setTimeout> | null = null;
  let pathCopyTimer: ReturnType<typeof setTimeout> | null = null;

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

  /** 현재 노트 절대 경로 복사. ⌘⇧C 단축키 + Editor/Preview pane-title 버튼 둘 다 호출. */
  async function copyCurrentPath() {
    const path = $currentNotePath;
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      pathCopied = true;
      if (pathCopyTimer) clearTimeout(pathCopyTimer);
      pathCopyTimer = setTimeout(() => (pathCopied = false), 1200);
    } catch (e) {
      console.error("copy current note path failed", e);
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

  /**
   * 페인 툴바 `⋯` 메뉴 항목.
   *
   * 복사류는 `keepOpen: true` — 결과가 레이블 자체("✓ 복사됨")로 표시되므로
   * 메뉴를 닫으면 피드백이 보이지 않는다. 바깥에 남긴 것은 빈도가 높은 `Aa`(글꼴)와
   * 구조적인 접기 버튼뿐이다.
   */
  /** 프리뷰 본문 엘리먼트 — HTML 내보내기가 이 라이브 DOM을 clone한다(Mermaid SVG 포함). */
  let renderedArticleEl: HTMLElement | undefined = $state();

  /** Editor·Preview 양쪽 `⋯`에 같은 모양으로 들어가는 항목. 현재 노트를 Finder에서 연다. */
  function revealMenuItem(): PaneMenuItem {
    const path = $currentNotePath;
    return {
      id: "reveal",
      label: "📂 Finder에서 보기",
      title: "현재 노트를 Finder에서 선택된 상태로 열기",
      disabled: !path,
      onSelect: () => revealInFinder(path ?? ""),
    };
  }

  const editorMenuItems: PaneMenuItem[] = $derived([
    {
      id: "copy-path",
      label: pathCopied ? "✓ 복사됨" : "🔗 경로 복사",
      title: "현재 노트의 절대 경로 복사 (⌘⇧C)",
      disabled: !$currentNotePath,
      keepOpen: true,
      onSelect: copyCurrentPath,
    },
    {
      id: "copy-markdown",
      label: editorCopied ? "✓ 복사됨" : "📋 마크다운 복사",
      title: "마크다운 원본 전체 복사",
      keepOpen: true,
      onSelect: copyEditor,
    },
    revealMenuItem(),
  ]);

  const previewMenuItems: PaneMenuItem[] = $derived([
    {
      id: "copy-path",
      label: pathCopied ? "✓ 복사됨" : "🔗 경로 복사",
      title: "현재 노트의 절대 경로 복사 (⌘⇧C)",
      disabled: !$currentNotePath,
      keepOpen: true,
      onSelect: copyCurrentPath,
    },
    {
      id: "copy-rich",
      label: previewCopied ? "✓ 복사됨" : "📋 리치 텍스트 복사",
      title: "리치 텍스트로 복사 (Confluence·메일 등 서식 유지)",
      keepOpen: true,
      onSelect: copyPreview,
    },
    {
      id: "export-html",
      label: "💾 HTML로 저장…",
      title: "프리뷰 내용을 자립형 HTML 파일로 저장 (CSS·이미지 포함)",
      disabled: !$currentNotePath,
      onSelect: () => exportPreviewToHtml(renderedArticleEl, $currentNotePath),
    },
    revealMenuItem(),
  ]);

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

  // 컨텍스트 패널 폭 리사이저 — 패널이 **우측**이라 드래그 방향이 사이드바와 반대다
  // (오른쪽으로 끌면 폭이 줄어든다). 더블클릭은 기본값(300) 복원.
  function startContextResize(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = get(contextWidth);
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      setContextWidth(startW - (ev.clientX - startX));
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

  async function confirmAndDeleteCurrent(path: string) {
    const name = path.split("/").pop() ?? path;
    if (!confirm(`노트 "${name}"을(를) 휴지통으로 이동할까요?`)) return;
    await deletePath(path);
  }

  // 전역 키보드 단축키
  // - F2                     : 현재 노트 이름 변경
  // - Cmd/Ctrl + Backspace/Delete : 현재 노트를 휴지통으로
  // - Cmd/Ctrl+K            : 통합 명령 팔레트 (toggle) — Phase 4.5
  // - Cmd/Ctrl+P            : Quick Switcher (파일 그룹만 — 호환)
  // - Cmd/Ctrl+Shift+F (또는 P): 풀텍스트 (Content 그룹만 — 호환)
  // - Cmd/Ctrl+Shift+T      : 직전 노트 다시 열기 (Phase 4.5.b)
  // 모달이 이미 열려 있을 때는 CommandPalette 내부 핸들러가 ESC/화살표 등 처리
  function handleGlobalKey(e: KeyboardEvent) {
    // 입력/편집 영역 안에서는 단축키를 가로채지 않음
    // (CodeMirror는 contenteditable, FileTree 인라인 rename은 INPUT)
    const target = e.target as HTMLElement | null;
    const inEditing = !!target && (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable
    );

    // F2 — 현재 노트 이름 변경 (modifier 없음). 입력 중이면 패스.
    if (e.key === "F2" && !e.metaKey && !e.ctrlKey && !inEditing) {
      const cur = $currentNotePath;
      if (cur) {
        e.preventDefault();
        requestRename(cur);
      }
      return;
    }

    // Cmd/Ctrl + Backspace/Delete — 현재 노트를 휴지통으로. 입력 중이면 패스.
    if (
      (e.key === "Backspace" || e.key === "Delete") &&
      (e.metaKey || e.ctrlKey) &&
      !inEditing
    ) {
      const cur = $currentNotePath;
      if (cur) {
        e.preventDefault();
        void confirmAndDeleteCurrent(cur);
      }
      return;
    }

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
    } else if (key === "s" && !e.shiftKey) {
      e.preventDefault();
      void saveCurrentNote();
    } else if (key === "f" && !e.shiftKey) {
      // Cmd+F — 현재 문서 내 검색. 마지막 포커스 영역에서 열기.
      e.preventDefault();
      const target = get(lastFocused);
      // collapsed 상태면 펼친 쪽으로 fallback
      const safeTarget =
        (target === "editor" && get(editorCollapsed)) ||
        (target === "preview" && get(previewCollapsed))
          ? target === "editor" ? "preview" : "editor"
          : target;
      openSearch(safeTarget);
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
    } else if (key === "c" && e.shiftKey) {
      // Cmd+Shift+C — 현재 노트 절대 경로 복사.
      // copyCurrentPath()를 그대로 호출 → Editor/Preview pane-title 버튼과 동일한 ✓ 플래시.
      if (!$currentNotePath) return;
      e.preventDefault();
      void copyCurrentPath();
    } else if (e.altKey && (e.code === "KeyB" || key === "b" || e.key === "∫")) {
      // Cmd+Opt+B — 우측 컨텍스트 패널 접기/펼치기.
      // ⚠️ macOS에서 Option은 문자를 바꾼다(⌥B → "∫") — e.key만 보면 놓친다.
      // 반대로 일부 환경(자동화·리모트 입력)은 e.code를 비워 보낸다. 어느 한쪽에
      // 의존하지 않도록 code·key를 **모두** 허용한다. ⌘B 분기보다 먼저 와야 한다.
      e.preventDefault();
      toggleContext();
    } else if (key === "b" && !e.shiftKey && !e.altKey) {
      // Cmd+B — 사이드바 접기/펼치기 (VS Code 표준)
      e.preventDefault();
      toggleSidebar();
    } else if (key === "e" && e.shiftKey) {
      // Cmd+Shift+E — 사이드바 파일 트리 필터 input에 포커스 (Explorer)
      e.preventDefault();
      const input = document.querySelector<HTMLInputElement>(".tree-filter-input");
      if (input) {
        input.focus();
        input.select();
      }
    } else if (key === "o" && e.shiftKey) {
      // Cmd+Shift+O — 아웃라인(TOC) 패널 표시 (사이드바 접혀 있으면 펼침)
      e.preventDefault();
      if (get(sidebarCollapsed)) toggleSidebar();
      showOutlineTab();
    } else if (key === "g" && !e.shiftKey && GRAPH_FEATURE_ENABLED) {
      // Cmd+G — 현재 노트 중심 Local 그래프 (ADR-003 PR-G2′).
      // ⌘⇧G는 macOS Finder "폴더로 이동" 시스템 단축과 겹쳐 webview에 도달 못함.
      // 그래프 기능 비활성(GRAPH_FEATURE_ENABLED=false) 시 이 분기를 타지 않음.
      e.preventDefault();
      const cur = $currentNotePath;
      if (cur) openGraph(cur);
    } else if ((key === "arrowleft" || key === "arrowright") && e.metaKey && e.ctrlKey) {
      // Cmd+Ctrl+← / → — 노트 뒤로/앞으로 가기 (Xcode 동일)
      e.preventDefault();
      if (key === "arrowleft") void goBackNote();
      else void goForwardNote();
    } else if (key === "w" && !e.shiftKey) {
      // Cmd+W — 활성 탭 닫기
      e.preventDefault();
      const cur = $currentNotePath;
      if (cur) void closeTab(cur);
    } else if (/^[1-9]$/.test(key) && !e.shiftKey) {
      // Cmd+1~9 — N번째 탭
      const path = tabPathForShortcut(get(openTabs), Number(key));
      if (path) {
        e.preventDefault();
        if (path !== $currentNotePath) void selectNote(path);
      }
    }
  }

  // Workspace 5-column grid를 collapse 상태 조합으로 동적 산출.
  // rail / sidebar / resizer / editor / preview 순. 클래스별 하드코딩 대신 derived로
  // 조합 폭발(사이드바×에디터×프리뷰)을 피한다.
  //
  // 레일은 **상시** 표시(폭 고정) — 접기의 최소 상태가 곧 레일이다. 사이드바 접힘은
  // 이제 "레일로 교체"가 아니라 "폭 0"이라, 화면에 보이는 결과는 종전과 같으면서
  // 레일이 늘 같은 자리에 머문다.
  // rail / sidebar / rz / editor / preview / rz2 / context — 7열.
  // 컨텍스트 패널은 Editor/Preview 가드와 무관하게 독립 접힘(36px 스트립 ↔ --context-w).
  const gridCols = $derived(
    `var(--rail-w, 52px) ` +
      `${$sidebarCollapsed ? "0px" : "var(--sidebar-w, 260px)"} ` +
      `${$sidebarCollapsed ? "0px" : "4px"} ` +
      `${$editorCollapsed ? "36px" : "1fr"} ` +
      `${$previewCollapsed ? "36px" : "1fr"} ` +
      `${$contextCollapsed ? "0px" : "4px"} ` +
      `${$contextCollapsed ? "36px" : "var(--context-w, 300px)"}`,
  );

  // Topbar 버전 라벨 — Tauri runtime의 Cargo.toml version을 단일 진실로 사용.
  // package.json/tauri.conf.json와 동기되지 않은 stale 값을 표시할 위험을 원천 차단.
  let appVersion = $state<string>("");

  onMount(() => {
    restoreTheme();
    restoreDensity();
    void restoreSettings();
    restorePaneState();
    restoreLastVault();
    void (async () => {
      try {
        appVersion = await getVersion();
      } catch (e) {
        console.warn("[app] getVersion failed", e);
      }
    })();
  });
</script>

<svelte:window onkeydown={handleGlobalKey} />

<CommandPalette />
<ContextMenu />
<NewNoteModal />
<SettingsModal />
{#if GRAPH_FEATURE_ENABLED}<GraphModal />{/if}
<LinkRewritePreviewModal />

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
    {#if appVersion}
      <span class="phase">v{appVersion}</span>
    {/if}
    <div class="nav-history">
      <button
        class="btn btn--icon btn--sm"
        title="뒤로 (⌘⌃←)"
        aria-label="뒤로 가기"
        disabled={!$canGoBack}
        onclick={() => void goBackNote()}
      >◀</button>
      <button
        class="btn btn--icon btn--sm"
        title="앞으로 (⌘⌃→)"
        aria-label="앞으로 가기"
        disabled={!$canGoForward}
        onclick={() => void goForwardNote()}
      >▶</button>
      <button
        class="btn btn--icon btn--sm nav-history-toggle"
        class:active={historyMenuOpen}
        title="방문 기록"
        aria-label="방문 기록 목록"
        aria-expanded={historyMenuOpen}
        disabled={!($canGoBack || $canGoForward)}
        onclick={() => (historyMenuOpen = !historyMenuOpen)}
      >▾</button>
      <NavHistoryMenu open={historyMenuOpen} onClose={() => (historyMenuOpen = false)} />
    </div>
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
    {#if $currentNotePath}
      <span class="doc-stats" title="단어 · 글자(공백 제외) · 예상 읽기 시간">
        {docStats.words.toLocaleString()}단어 · {docStats.charsNoSpaces.toLocaleString()}자 · {readingTimeLabel(docStats.readingMinutes)}
      </span>
    {/if}
    <div class="topbar-actions">
      <!-- watcher 상태 점은 사이드바 하단 상태 줄로 통합(2026-08-05 PR-10) —
           흩어진 상태 신호를 한 곳에서 읽게 하려는 것. -->
      {#if GRAPH_FEATURE_ENABLED}
        <button
          class="btn btn--icon btn--sm"
          title="Local 그래프 — 현재 노트 이웃 (⌘G)"
          disabled={!$currentNotePath}
          onclick={() => $currentNotePath && openGraph($currentNotePath)}
        >◉</button>
      {/if}
      <button
        class="btn btn--icon btn--sm"
        title="Command palette (Cmd+K)"
        onclick={() => openPalette("all")}
      >🔎</button>
    </div>
  </header>

  <GitBanner />

  <div
    class="workspace"
    style="--sidebar-w: {$sidebarWidth}px; --context-w: {$contextWidth}px; grid-template-columns: {gridCols};"
  >
    <SidebarRail />
    {#if $sidebarCollapsed}
      <!-- 폭 0 컬럼 자리지킴 — grid 컬럼 순서를 유지하면서 Sidebar는 언마운트해
           12000노트 트리의 렌더 비용을 접힘 상태에서 물지 않는다. -->
      <div class="sidebar-slot-empty" aria-hidden="true"></div>
    {:else}
      <Sidebar />
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="sidebar-resizer"
      class:rz-hidden={$sidebarCollapsed}
      role="separator"
      aria-orientation="vertical"
      aria-label="사이드바 폭 조절 (더블클릭으로 기본값 복원)"
      title="드래그로 폭 조절 · 더블클릭으로 복원"
      onmousedown={startSidebarResize}
      ondblclick={resetSidebarWidth}
    ></div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <section
      class="pane editor-pane"
      class:collapsed={$editorCollapsed}
      onmousedown={() => lastFocused.set("editor")}
    >
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
        <TabBar />
        <div class="pane-title">
          <span>Editor</span>
          <div class="pane-actions">
            <PaneMenu label="Editor 추가 작업" items={editorMenuItems} />
            {#if !$previewCollapsed}
              <button
                class="btn btn--icon btn--sm"
                title="에디터 접기"
                aria-label="에디터 접기"
                onclick={toggleEditor}
              >
                ◀
              </button>
            {/if}
          </div>
        </div>
        <InDocSearchBar
          target="editor"
          onQuery={editorOnQuery}
          onNext={editorOnNext}
          onPrev={editorOnPrev}
          onClosed={editorOnClosed}
          onOptionsChanged={editorOnOptionsChanged}
        />
        <div class="pane-body">
          <Editor bind:value={raw} bind:api={editorApi} onChange={handleEditorChange} />
        </div>
      {/if}
    </section>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <section
      class="pane preview-pane"
      class:collapsed={$previewCollapsed}
      onmousedown={() => lastFocused.set("preview")}
    >
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
            <ReadingControls />
            <PaneMenu label="Preview 추가 작업" items={previewMenuItems} />
            {#if !$editorCollapsed}
              <button
                class="btn btn--icon btn--sm"
                title="프리뷰 접기"
                aria-label="프리뷰 접기"
                onclick={togglePreview}
              >
                ▶
              </button>
            {/if}
          </div>
        </div>
        <InDocSearchBar
          target="preview"
          onQuery={previewRecompute}
          onNext={previewOnNext}
          onPrev={previewOnPrev}
          onClosed={previewOnClosed}
          onOptionsChanged={previewOnOptionsChanged}
        />
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="pane-body" bind:this={previewBodyEl} onclick={handlePreviewClick} onscroll={handlePreviewScroll}>
        <!-- 속성·관계·발행자산은 2026-08-05(PR-4)에 우측 컨텍스트 패널로 이전.
             Preview는 이제 **본문만** 담는다. -->
        <article
          class="rendered"
          bind:this={renderedArticleEl}
          style="--reading-font-size: {$readingFontSize}px;{$readingMeasureLimited
            ? ''
            : ' --reading-measure: none;'}"
        >
          {@html parsed.html}
        </article>
      </div>
      {/if}
    </section>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="sidebar-resizer"
      class:rz-hidden={$contextCollapsed}
      role="separator"
      aria-orientation="vertical"
      aria-label="컨텍스트 패널 폭 조절 (더블클릭으로 기본값 복원)"
      title="드래그로 폭 조절 · 더블클릭으로 복원"
      onmousedown={startContextResize}
      ondblclick={resetContextWidth}
    ></div>

    <section class="pane context-pane" class:collapsed={$contextCollapsed}>
      {#if $contextCollapsed}
        <button
          class="collapsed-strip"
          title="컨텍스트 패널 펼치기 (⌘⌥B)"
          aria-label="컨텍스트 패널 펼치기"
          onclick={toggleContext}
        >
          <span class="strip-icon">◀</span>
          <span class="strip-label">Context</span>
        </button>
      {:else}
        <div class="pane-title">
          <span>Context</span>
          <div class="pane-actions">
            <button
              class="btn btn--icon btn--sm btn--plain"
              title="컨텍스트 패널 접기 (⌘⌥B)"
              aria-label="컨텍스트 패널 접기"
              onclick={toggleContext}
            >
              ▶
            </button>
          </div>
        </div>
        <ContextPanel
          properties={{ data: effectiveProperties, isAuto: propertiesAuto, rawNote: raw }}
          neighborhood={$currentNotePath
            ? {
                targetNote: currentNoteInfo,
                outgoing: currentOutgoing,
                incoming: currentIncoming,
                backlinks: currentBacklinks,
              }
            : null}
          notePath={$currentNotePath}
        />
      {/if}
    </section>
  </div>
</div>

<style>
  /* 베이스 리셋(html/body, box-sizing)·focus·reduced-motion은 src/app.css가 소유 */

  /* in-document search Preview 하이라이트 (Phase 5.0) — <mark> 삽입 방식 */
  :global(.preview-pane mark.lapis-search-match) {
    background-color: rgba(255, 200, 0, 0.35);
    color: inherit;
    padding: 0;
    border-radius: var(--r-xs);
  }

  :global(.preview-pane mark.lapis-search-current) {
    background-color: rgba(255, 140, 0, 0.75);
    color: inherit;
    padding: 0;
    border-radius: var(--r-xs);
  }

  /* Editor 측 cm-searchMatch는 Editor.svelte의 EditorView.theme()에서 override (specificity 문제로 일반 CSS는 안 통함) */

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  .topbar {
    display: flex;
    align-items: center;
    gap: var(--sp-5);
    /* 세로 여백을 --sp-3으로 줄여 크롬을 얇게 — 컨트롤 높이가 실질 높이를 정한다
       (default 24+12=36px, compact 20+8=28px). */
    padding: var(--sp-3) var(--sp-6);
    /* 크롬 계층 — 아래 본문(--surface-content)보다 어두워 보더 없이 분리된다. */
    background: var(--surface-panel);
    font-size: var(--fs-base);
  }

  .brand {
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--accent);
  }

  .phase {
    color: var(--text-secondary);
  }

  .nav-history {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
  }

  .meta {
    margin-left: auto;
    color: var(--text-muted);
    font-size: var(--fs-sm);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    max-width: 40%;
    display: inline-flex;
    align-items: center;
    gap: var(--sp-4);
  }

  .doc-stats {
    color: var(--text-muted);
    font-size: var(--fs-xs);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .save-badge {
    font-size: var(--fs-xs);
    padding: var(--sp-1) var(--sp-3);
    border-radius: var(--r-lg);
    font-weight: 500;
    flex-shrink: 0;
  }

  .save-badge.dirty {
    color: var(--warning);
    background: var(--warning-bg-subtle);
    border: 1px solid var(--warning-border);
  }

  .save-badge.saving {
    color: var(--accent);
    background: var(--accent-bg-subtle);
    border: 1px solid var(--accent-border);
  }

  .save-badge.error {
    color: var(--danger);
    background: var(--danger-bg-subtle);
    border: 1px solid var(--danger-border);
  }

  /* 외부 변경 충돌 다이얼로그 */
  .conflict-backdrop {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal);
    padding: var(--sp-10);
  }

  .conflict-modal {
    width: min(var(--modal-w-lg), 92vw);
    background: var(--surface-raised);
    border: 1px solid var(--danger-border);
    border-radius: var(--r-lg);
    overflow: hidden;
    color: var(--text-primary);
    box-shadow: var(--shadow-overlay);
  }

  .conflict-head {
    display: flex;
    align-items: center;
    gap: var(--sp-5);
    padding: var(--sp-5) var(--sp-6);
    background: var(--danger-bg-subtle);
    border-bottom: 1px solid var(--danger-border);
    font-weight: 600;
    color: var(--danger);
  }

  .conflict-icon {
    font-size: var(--fs-lg);
    color: var(--danger);
  }

  .conflict-body {
    padding: var(--sp-6);
    line-height: 1.6;
    font-size: var(--fs-md);
    color: var(--text-secondary);
  }

  .conflict-body .path {
    margin: var(--sp-4) 0;
    padding: var(--sp-3) var(--sp-5);
    background: var(--surface-overlay);
    border-radius: var(--r-sm);
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    word-break: break-all;
  }

  .conflict-body .hint {
    color: var(--text-secondary);
    margin-top: var(--sp-5);
  }

  .conflict-foot {
    display: flex;
    gap: var(--sp-4);
    padding: var(--sp-5);
    background: var(--surface-raised);
    border-top: 1px solid var(--danger-border);
  }

  .conflict-foot .btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-5);
    background: var(--surface-overlay);
    border: 1px solid var(--border-strong);
    color: var(--text-secondary);
    border-radius: var(--r-md);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--fs-base);
    font-weight: 600;
    transition: background var(--dur-fast), border-color var(--dur-fast), color var(--dur-fast);
  }

  .conflict-foot .btn:hover {
    background: var(--surface-sunken);
  }

  .conflict-foot .btn.keep {
    border-color: var(--warning);
    color: var(--warning);
  }
  .conflict-foot .btn.keep:hover {
    background: var(--warning-bg-subtle);
  }

  .conflict-foot .btn.accept {
    border-color: var(--accent);
    color: var(--accent);
  }
  .conflict-foot .btn.accept:hover {
    background: var(--accent-bg-subtle);
  }

  .conflict-foot .btn .hint {
    font-size: var(--fs-xs);
    font-weight: 400;
    color: var(--text-muted);
  }

  .topbar-actions {
    display: flex;
    gap: var(--sp-2);
    margin-left: var(--sp-4);
    align-items: center;
  }

  .workspace {
    flex: 1;
    display: grid;
    /* grid-template-columns는 인라인 style의 gridCols(derived)로 지정 — collapse 조합 대응 */
    overflow: hidden;
    transition: grid-template-columns 0.18s ease;
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
    background: var(--accent);
  }

  /* 사이드바 접힘 시 resizer는 0px 컬럼 — 드래그 비활성화 */
  .sidebar-resizer.rz-hidden {
    pointer-events: none;
  }

  /* 사이드바 접힘 시 grid 컬럼 자리만 지키는 빈 슬롯(폭 0). */
  .sidebar-slot-empty {
    overflow: hidden;
  }

  /* 우측 컨텍스트 패널 — 사이드바와 같은 크롬 계층이라 본문을 사이에 두고 좌우 대칭. */
  .context-pane {
    background: var(--surface-panel);
    border-right: none;
  }

  .pane {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    /* 3계층 중 가장 밝은 면 — 시선이 여기로 모인다. */
    background: var(--surface-content);
    /* Editor↔Preview는 **같은 계층**의 분할이라 명암차로 나눌 수 없다.
       영역 간 분리(레일↔사이드바↔본문)만 보더를 걷어내고, 여기는 subtle로 남긴다. */
    border-right: 1px solid var(--border-subtle);
  }

  .pane:last-child {
    border-right: none;
  }

  .pane-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-4);
    padding: var(--sp-2) var(--sp-4) var(--sp-2) var(--sp-5);
    font-size: var(--fs-xs);
    /* uppercase + letter-spacing은 2016년대 대시보드 관용구 — 굵기로 위계를 준다. */
    font-weight: 600;
    color: var(--text-muted);
    background: var(--surface-panel);
    min-height: var(--control-h-lg);
  }

  .pane-actions {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }

  /* 접힌 pane의 세로 띠 — 클릭하면 다시 펼침.
     스트립은 크롬 계층(--surface-panel)이라 본문과 명암차로 분리된다. */
  .pane.collapsed {
    border-right: none;
  }

  .collapsed-strip {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: var(--sp-5);
    padding: var(--sp-5) 0;
    background: var(--surface-panel);
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-family: inherit;
    transition: background var(--dur-base), color var(--dur-base);
  }

  .collapsed-strip:hover {
    background: var(--surface-sunken);
    color: var(--accent);
  }

  .strip-icon {
    font-size: var(--fs-base);
    line-height: 1;
  }

  .strip-label {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    user-select: none;
  }

  .pane-body {
    flex: 1;
    overflow: auto;
  }

  .preview-pane .pane-body {
    padding: var(--sp-8) var(--sp-10);
  }

  /* Properties 패널 CSS는 src/lib/Properties.svelte로 이전 (Phase 4.3.a) */

  /* 렌더된 마크다운 본문(.rendered) CSS는 src/lib/styles/rendered.css로 이전 (2026-08-03).
     HTML 내보내기가 같은 파일을 ?raw로 읽어 인라인하므로 여기에 되돌리지 말 것 —
     Svelte scoped가 되면 .rendered.svelte-xxxx 가 붙어 내보내기에서 재사용 불가. */

  /* 이웃(관계+백링크) 패널 CSS는 src/lib/Neighborhood.svelte로 이전 (Phase A-2) */
</style>
