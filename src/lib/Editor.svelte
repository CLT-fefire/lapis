<script lang="ts" module>
  export interface EditorSearchOptions {
    caseSensitive?: boolean;
    wholeWord?: boolean;
    regex?: boolean;
  }

  export interface EditorMatchInfo {
    total: number;
    current: number;
    /** regex 모드에서 패턴 자체가 invalid인 경우 true. */
    regexError?: boolean;
  }

  export interface EditorApi {
    setQuery: (q: string, opts?: EditorSearchOptions) => EditorMatchInfo;
    findNext: () => EditorMatchInfo;
    findPrev: () => EditorMatchInfo;
    clearQuery: () => void;
    focus: () => void;
    /** 1-based 라인으로 커서 이동 + 스크롤 (아웃라인 TOC 점프용). */
    jumpToLine: (line: number) => void;
    /**
     * 지금 보고 있는 1-based 라인 — 편집 → 읽기 교대 때 섹션 앵커를 뽑는 기준
     * (`paneAnchor.ts`). 커서가 화면 안이면 **커서**(방금 고친 자리), 스크롤만 해서
     * 커서가 화면 밖이면 **뷰포트 상단**을 돌려준다.
     */
    getFocusLine: () => number;
    /**
     * 스크롤 위치를 px로 지정. **노트를 바꿀 때 맨 위(0)로 보내는 용도만** 쓴다.
     *
     * ⚠️ 임의 px 복원용으로 쓰지 말 것 — CodeMirror의 `scrollTop`은 height map이
     * 얼마나 실측됐는지에 따라 같은 값이 다른 위치를 가리킨다(같은 문서에서
     * scrollHeight 10902 ↔ 21385 관측). 위치를 되살릴 땐 `jumpToLine`을 쓴다.
     */
    setScrollTop: (px: number) => void;
  }
</script>

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { get } from "svelte/store";
  import { EditorState } from "@codemirror/state";
  import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { markdown } from "@codemirror/lang-markdown";
  import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
  import { tags as t } from "@lezer/highlight";
  import { linkIndex } from "$lib/stores/vault";
  import type { LinkIndex } from "$lib/linkIndex";
  import {
    wikilinkCompletionExtension,
    type WikilinkCandidate,
  } from "$lib/wikilinkComplete";
  import {
    search,
    setSearchQuery,
    getSearchQuery,
    openSearchPanel,
    closeSearchPanel,
    findNext,
    findPrevious,
    SearchQuery,
  } from "@codemirror/search";

  // 디자인 토큰 기반 에디터 테마 (oneDark 대체).
  // 모든 색을 var(--cm-*)로 지정 → data-theme 전환 시 자동 적응 (Compartment 불필요).
  const lapisTheme = EditorView.theme(
    {
      "&": {
        color: "var(--cm-fg)",
        backgroundColor: "var(--cm-bg)",
      },
      ".cm-content": {
        caretColor: "var(--cm-caret)",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--cm-caret)",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        {
          backgroundColor: "var(--cm-selection)",
        },
      ".cm-activeLine": {
        backgroundColor: "var(--cm-active-line)",
      },
      ".cm-gutters": {
        backgroundColor: "var(--cm-bg)",
        color: "var(--cm-gutter-fg)",
        border: "none",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "var(--cm-active-line)",
        color: "var(--cm-gutter-active-fg)",
      },
      // 위키링크 자동완성 드롭다운 — 디자인 토큰으로 라이트/다크 자동 적응
      // (기본 드롭다운은 흰 배경 고정이라 다크모드 부조화).
      ".cm-tooltip.cm-tooltip-autocomplete": {
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--r-sm)",
        backgroundColor: "var(--surface-overlay)",
        boxShadow: "var(--shadow-md)",
        overflow: "hidden",
      },
      ".cm-tooltip-autocomplete > ul": {
        fontFamily: "var(--font-sans)",
        maxHeight: "16em",
      },
      ".cm-tooltip-autocomplete > ul > li": {
        padding: "var(--sp-1) var(--sp-3)",
        color: "var(--text-primary)",
      },
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
        backgroundColor: "var(--accent)",
        color: "var(--accent-fg)",
      },
      ".cm-completionDetail": {
        marginLeft: "var(--sp-3)",
        color: "var(--text-muted)",
        fontStyle: "italic",
      },
      ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail": {
        color: "var(--accent-fg)",
        opacity: "0.85",
      },
      ".cm-completionMatchedText": {
        color: "var(--accent)",
        textDecoration: "none",
        fontWeight: "600",
      },
      ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionMatchedText": {
        color: "inherit",
      },
    },
    { dark: false },
  );

  // 마크다운 syntax 하이라이팅 (var() 토큰 → 라이트/다크 자동 적응).
  const lapisHighlight = HighlightStyle.define([
    { tag: t.heading, color: "var(--cm-heading)", fontWeight: "600" },
    { tag: t.strong, color: "var(--cm-strong)", fontWeight: "700" },
    { tag: t.emphasis, color: "var(--cm-emphasis)", fontStyle: "italic" },
    { tag: [t.link, t.url], color: "var(--cm-link)", textDecoration: "underline" },
    { tag: t.quote, color: "var(--cm-quote)", fontStyle: "italic" },
    { tag: t.list, color: "var(--cm-list)" },
    { tag: t.monospace, color: "var(--cm-code)" },
    { tag: [t.processingInstruction, t.meta], color: "var(--cm-meta)" },
    { tag: t.keyword, color: "var(--cm-keyword)" },
    { tag: t.string, color: "var(--cm-string)" },
    { tag: [t.number, t.bool, t.atom], color: "var(--cm-number)" },
    { tag: t.comment, color: "var(--cm-comment)", fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
  ]);

  // 검색 매치 시각화 override (노란 하이라이트는 라이트/다크 양쪽에서 동일하게 유효).
  // selected 매치 안의 자식(syntax span 포함)을 어두운 글자로 강제 → 노란 배경 + 검정 대비.
  const searchHighlightTheme = EditorView.theme({
    ".cm-searchMatch": {
      backgroundColor: "rgba(255, 200, 0, 0.30)",
      outline: "none",
      borderRadius: "2px",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "#ffc107",
      outline: "1.5px solid #ff7a00",
      borderRadius: "2px",
    },
    ".cm-searchMatch.cm-searchMatch-selected, .cm-searchMatch.cm-searchMatch-selected *":
      {
        color: "#1a1a1a !important",
        fontWeight: "600",
      },
  });

  interface Props {
    value: string;
    onChange?: (value: string) => void;
    api?: EditorApi | undefined;
  }

  let { value = $bindable(""), onChange, api = $bindable() }: Props = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;

  /** linkIndex의 모든 노트 → 위키링크 자동완성 후보. 동일 stem은 부모 폴더명으로 구분. */
  function buildCandidates(idx: LinkIndex | null): WikilinkCandidate[] {
    if (!idx) return [];
    const out: WikilinkCandidate[] = [];
    for (const info of idx.byPath.values()) {
      const segs = info.source_path.split("/").filter(Boolean);
      const parent = segs.length >= 2 ? segs[segs.length - 2] : undefined;
      out.push({
        stem: info.source_name,
        title: info.title,
        aliases: info.aliases,
        rel: parent,
      });
    }
    return out;
  }

  function getMatchInfo(view: EditorView): EditorMatchInfo {
    const sq = getSearchQuery(view.state);
    if (!sq.search) return { total: 0, current: 0 };
    // regex invalid 등으로 query 자체가 유효하지 않으면 cursor 생성 X.
    if (!sq.valid) return { total: 0, current: 0, regexError: sq.regexp };
    const sel = view.state.selection.main;
    // SearchQuery.getCursor는 옵션(regexp/caseSensitive/wholeWord)에 따라 적절한
    // SearchCursor 또는 RegExpCursor를 반환. 두 cursor 모두 next()/value.from/to 인터페이스 공유.
    const cursor = sq.getCursor(view.state);
    let total = 0;
    let current = 0;
    let step = cursor.next();
    while (!step.done) {
      total++;
      const v = step.value as { from: number; to: number };
      if (v.from === sel.from && v.to === sel.to) {
        current = total;
      }
      step = cursor.next();
    }
    return { total, current };
  }

  function makeQuery(q: string, opts: EditorSearchOptions): SearchQuery {
    return new SearchQuery({
      search: q,
      caseSensitive: opts.caseSensitive === true,
      wholeWord: opts.wholeWord === true,
      regexp: opts.regex === true,
    });
  }

  /**
   * 사용자가 이 view에서 **직접** 스크롤했는지. 앵커 점프 같은 프로그램 스크롤과
   * 구분해야 한다 — `getFocusLine()`이 "커서를 쓸까, 보고 있는 쪽을 쓸까"를 이걸로 가른다.
   * 컴포넌트가 교대마다 새로 mount되므로 매번 false에서 시작한다.
   */
  let userScrolled = false;

  /**
   * ⚠️ **갓 mount된 view에 스크롤을 한 번만 지정하면 엉뚱한 데 선다.** CodeMirror는
   * 아직 렌더하지 않은 줄을 **추정 높이**로 둔 height map으로 스크롤 위치를 계산한다.
   * 그래서 dispatch 직후의 `scrollHeight`가 실측과 다르고, 그 차이만큼 빗나간다.
   * 실측 사례(welcome 41행): dispatch 때 1149px → 측정 후 1380px, 착지가 38px 초과.
   * **긴 문서에서 오차가 커진다** — 474행 한글 문서(줄바꿈 다발)에서 90행쯤 밀렸다.
   *
   * 읽기↔편집 교대(⌘E)는 **매번 Editor를 새로 mount**하므로 이 경로를 항상 지난다.
   * 커서만 옮겨지고 화면은 안 따라가는 형태라 타입체크·테스트엔 안 잡힌다.
   *
   * 대책: 측정이 진행되는 다음 프레임마다 **같은 위치로 다시 적용**한다. 매 패스마다
   * 그 주변이 실제로 렌더·측정돼 height map이 실측으로 대체되며 정확해진다.
   *
   * ⚠️ 종료 조건은 **대상 줄이 실제로 상단에 왔는지**(`coordsAtPos`)로 판정한다.
   * "스크롤이 더 안 움직인다"를 수렴으로 쓰면 안 된다 — 추정 height map이 "이미
   * 도착했다"고 계산하면 **움직이지 않고도 빗나간 채 종료**한다(실측 2530px = 120행).
   */
  function scrollPosToTop(view: EditorView, pos: number): void {
    let aborted = false;
    const abort = () => {
      aborted = true;
    };
    // 사용자가 휠·타이핑을 시작하면 즉시 손을 뗀다 — 안 그러면 몇 프레임 동안 다툰다.
    view.scrollDOM.addEventListener("wheel", abort, { passive: true });
    view.dom.addEventListener("keydown", abort);
    const cleanup = () => {
      view.scrollDOM.removeEventListener("wheel", abort);
      view.dom.removeEventListener("keydown", abort);
    };

    const pass = (tries: number) => {
      view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "start" }) });
      if (tries <= 0) return cleanup();
      requestAnimationFrame(() => {
        // ⌘E 연타로 그 사이 view가 destroy될 수 있다.
        if (aborted || !view.dom.isConnected) return cleanup();
        const coords = view.coordsAtPos(pos);
        const paneTop = view.scrollDOM.getBoundingClientRect().top;
        // 렌더돼 있고 상단에 붙었으면 진짜 도착. 아직 렌더 안 됐으면(null) 계속 간다.
        if (coords && Math.abs(coords.top - paneTop) <= 8) return cleanup();
        // 문서 끝이라 더 올릴 수 없는 위치면 여기가 최선이다.
        const max = view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight;
        if (view.scrollDOM.scrollTop >= max - 1) return cleanup();
        pass(tries - 1);
      });
    };
    pass(10);
  }

  function buildApi(view: EditorView): EditorApi {
    return {
      setQuery(q: string, opts: EditorSearchOptions = {}) {
        // panel 활성화(이미 열려 있으면 no-op) → searchHighlighter가 매치 데코레이션을 그리는 조건 충족
        openSearchPanel(view);
        const sq = makeQuery(q, opts);
        view.dispatch({ effects: setSearchQuery.of(sq) });
        // regex invalid면 findNext가 throw할 수 있음 → valid 체크 후 호출.
        if (q && sq.valid) findNext(view);
        const info = getMatchInfo(view);
        // valid가 false인데 regex 모드면 regexError 명시.
        if (!sq.valid && opts.regex) {
          return { ...info, regexError: true };
        }
        return info;
      },
      findNext() {
        const sq = getSearchQuery(view.state);
        if (sq.search && sq.valid) findNext(view);
        return getMatchInfo(view);
      },
      findPrev() {
        const sq = getSearchQuery(view.state);
        if (sq.search && sq.valid) findPrevious(view);
        return getMatchInfo(view);
      },
      clearQuery() {
        const sq = new SearchQuery({ search: "" });
        view.dispatch({ effects: setSearchQuery.of(sq) });
        closeSearchPanel(view);
      },
      focus() {
        view.focus();
      },
      jumpToLine(line: number) {
        const total = view.state.doc.lines;
        const n = Math.min(Math.max(1, Math.floor(line)), total);
        const info = view.state.doc.line(n);
        view.dispatch({ selection: { anchor: info.from } });
        scrollPosToTop(view, info.from);
        view.focus();
      },
      getFocusLine() {
        const doc = view.state.doc;
        const cursorLine = doc.lineAt(view.state.selection.main.head).number;
        // 사용자가 이 view에서 직접 스크롤한 적이 없으면 **커서가 진실**이다 — 커서는
        // 우리가 앵커 점프로 거기 두었고, 그 뒤로 아무도 옮기지 않았다.
        //
        // ⚠️ 기하만 보고 판정하면 안 된다. 앵커 점프의 스크롤은 measure 사이클(rAF)에서
        //    적용되므로, 그 전에 ⌘E를 다시 누르면 뷰포트가 **아직 맨 위**다 → "커서가
        //    화면 밖"으로 오판해 1행을 돌려주고 프리뷰가 문서 맨 위로 튄다.
        if (!userScrolled) return cursorLine;

        // 사용자가 스크롤했다면 지금 보고 있는 쪽이 진실이다. 뷰포트 상·하단에 걸린 줄을
        // **문서 상대 높이**로 조회한다.
        //
        // ⚠️ 좌표 기반 `posAtCoords`를 쓰면 안 된다 — x가 라인번호 거터에 걸리고
        //    문서 끝 근처에서는 **보이지 않는 줄**을 돌려준다. 실측: 442행이 상단에
        //    보이는데(스크롤 max) 상·하단 모두 475(문서 끝)로 답했다.
        const top = view.scrollDOM.getBoundingClientRect().top - view.documentTop;
        const topLine = doc.lineAt(view.lineBlockAtHeight(top).from).number;
        const bottomLine = doc.lineAt(
          view.lineBlockAtHeight(top + view.scrollDOM.clientHeight).from,
        ).number;
        return cursorLine >= topLine && cursorLine <= bottomLine ? cursorLine : topLine;
      },
      setScrollTop(px: number) {
        view.scrollDOM.scrollTop = px;
        // 같은 이유(위 scrollPosToTop) — 측정 전 scrollHeight가 작으면 값이 잘려 들어간다.
        requestAnimationFrame(() => {
          if (view.dom.isConnected && Math.abs(view.scrollDOM.scrollTop - px) >= 1) {
            view.scrollDOM.scrollTop = px;
          }
        });
      },
    };
  }

  onMount(() => {
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        markdown(),
        wikilinkCompletionExtension(() => buildCandidates(get(linkIndex))),
        lapisTheme,
        syntaxHighlighting(lapisHighlight),
        searchHighlightTheme, // 테마 이후에 → cm-searchMatch override
        EditorView.lineWrapping,
        // 검색 확장.
        // 매치 데코레이션(cm-searchMatch)은 CodeMirror 6 내부적으로 "panel이 active일 때만"
        // 그려진다(@codemirror/search 소스의 searchHighlighter ViewPlugin 참고).
        // 우리는 자체 검색바를 쓰므로 기본 panel 대신 hidden stub panel을 mount해서
        // panel을 "active 상태로 유지" → 매치 데코레이션이 자동 표시되게 한다.
        search({
          top: false,
          createPanel: () => {
            const dom = document.createElement("div");
            dom.style.display = "none";
            return { dom };
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const next = update.state.doc.toString();
            value = next;
            onChange?.(next);
          }
        }),
      ],
    });

    view = new EditorView({ state, parent: host });
    // 휠·트랙패드로 훑은 것만 "사용자 스크롤"로 본다. 클릭·키보드 이동은 커서를 함께
    // 옮기므로 커서가 곧 사용자 위치다 — 따로 표시할 필요가 없다.
    view.scrollDOM.addEventListener("wheel", markUserScrolled, { passive: true });
    api = buildApi(view);
  });

  function markUserScrolled() {
    userScrolled = true;
  }

  // 외부에서 value가 바뀌면 에디터 doc도 동기화 (예: 사이드바에서 다른 노트 선택)
  // current !== value 가드로 사용자 타이핑 시 무한 루프 방지
  $effect(() => {
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  });

  onDestroy(() => {
    view?.scrollDOM.removeEventListener("wheel", markUserScrolled);
    view?.destroy();
    api = undefined;
  });
</script>

<div bind:this={host} class="editor"></div>

<style>
  .editor {
    height: 100%;
    width: 100%;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-md);
  }

  :global(.editor .cm-editor) {
    height: 100%;
  }

  :global(.editor .cm-scroller) {
    font-family: inherit;
  }
</style>
