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
  }
</script>

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { markdown } from "@codemirror/lang-markdown";
  import { oneDark } from "@codemirror/theme-one-dark";
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

  // 검색 매치 시각화 override.
  // 기본 cm-searchMatch는 one-dark 청색 + outline으로 약하고,
  // selected는 노란 위 syntax 색이 묻혀 글자가 안 보이는 문제 → 색 + 글자 강제.
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
    // selected 매치 안의 모든 자식(syntax 색 span 포함)을 어두운 색으로 강제 →
    // 노란 배경 + 검정 글자로 명확한 대비.
    ".cm-searchMatch.cm-searchMatch-selected, .cm-searchMatch.cm-searchMatch-selected *":
      {
        color: "#1a1a1a !important",
        fontWeight: "600",
      },
    // 활성 라인 (커서/매치 위치 라인)도 one-dark 기본이 거의 안 보일 정도로 약함 → 살짝 진하게.
    ".cm-activeLine": {
      backgroundColor: "rgba(255, 255, 255, 0.045)",
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
        oneDark,
        searchHighlightTheme, // oneDark 이후에 → cm-searchMatch override
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
    api = buildApi(view);
  });

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
    font-family: "SF Mono", Menlo, Consolas, monospace;
    font-size: 14px;
  }

  :global(.editor .cm-editor) {
    height: 100%;
  }

  :global(.editor .cm-scroller) {
    font-family: inherit;
  }
</style>
