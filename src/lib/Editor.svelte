<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { markdown } from "@codemirror/lang-markdown";
  import { oneDark } from "@codemirror/theme-one-dark";

  interface Props {
    value: string;
    onChange?: (value: string) => void;
  }

  let { value = $bindable(""), onChange }: Props = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;

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
        EditorView.lineWrapping,
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
