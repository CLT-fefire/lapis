<script lang="ts" module>
  export interface EditorApi {
    setQuery: (q: string) => { total: number; current: number };
    findNext: () => { total: number; current: number };
    findPrev: () => { total: number; current: number };
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
    SearchCursor,
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

  function getMatchInfo(view: EditorView): { total: number; current: number } {
    const q = getSearchQuery(view.state).search;
    if (!q) return { total: 0, current: 0 };
    const doc = view.state.doc;
    const sel = view.state.selection.main;
    const norm = (x: string) => x.toLowerCase();
    const cursor = new SearchCursor(doc, q, 0, doc.length, norm);
    let total = 0;
    let current = 0;
    while (!cursor.next().done) {
      total++;
      if (cursor.value.from === sel.from && cursor.value.to === sel.to) {
        current = total;
      }
    }
    return { total, current };
  }

  function buildApi(view: EditorView): EditorApi {
    return {
      setQuery(q: string) {
        // panel 활성화(이미 열려 있으면 no-op) → searchHighlighter가 매치 데코레이션을 그리는 조건 충족
        openSearchPanel(view);
        const sq = new SearchQuery({ search: q, caseSensitive: false });
        view.dispatch({ effects: setSearchQuery.of(sq) });
        if (q) findNext(view);
        return getMatchInfo(view);
      },
      findNext() {
        if (getSearchQuery(view.state).search) findNext(view);
        return getMatchInfo(view);
      },
      findPrev() {
        if (getSearchQuery(view.state).search) findPrevious(view);
        return getMatchInfo(view);
      },
      clearQuery() {
        const sq = new SearchQuery({ search: "", caseSensitive: false });
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
