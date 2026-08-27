import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { CALLOUT_KINDS } from "$lib/markdownPlugins/callout";

/**
 * 편집기에서 **lapis 문법**을 표시하기 위한 구간 찾기.
 *
 * ## ⚠️ 왜 필요한가
 *
 * v2.3.0이 콜아웃과 임베드를 넣었는데 **편집 모드에서는 평범한 글자**다. 미리보기에서는
 * 색과 테두리가 붙는데 편집기에는 아무 표시가 없어서, `[!WARN]` 같은 오타를 저장하고
 * 미리보기로 넘어가서야 안다.
 *
 * ⚠️ **모르는 종류를 다르게 표시하는 것이 요점이다.** 알아보는 것만 칠하면 오타는 그냥
 * 안 칠해진 글자라 눈에 안 띈다. 아는 것 · 모르는 것 · 임베드를 갈라서 낸다.
 *
 * 순수 함수인 이유: CodeMirror 없이 테스트하기 위해서다. 데코레이션으로 바꾸는 것은
 * `Editor.svelte` 쪽 얇은 층이 한다.
 */

export type LapisSyntaxKind = "callout" | "callout-unknown" | "embed";

export interface SyntaxRange {
  from: number;
  to: number;
  kind: LapisSyntaxKind;
}

const KNOWN = new Set<string>(CALLOUT_KINDS);

// 인용문 첫 줄의 `[!TYPE]`. 줄 머리에서만 — 콜아웃 표식은 문단 첫 줄에만 뜻이 있다.
const CALLOUT_RE = /^[ \t]*>[ \t]*(\[!([A-Za-z]+)\])/;

// `![[…]]` — 임베드. 여는 `!` 부터 닫는 `]]` 까지.
const EMBED_RE = /!\[\[[^\[\]\n]*\]\]/g;

/**
 * 문서 전체에서 표시할 구간을 찾는다. 오프셋은 **문서 시작 기준**이다.
 *
 * ⚠️ 코드 펜스 안은 거르지 않는다. 편집기에서는 펜스 안의 예시도 **문법으로 보이는 편이**
 * 낫다 — 미리보기와 달리 여기서는 \"이게 무엇으로 읽히는지\"를 보여주는 게 목적이고,
 * 펜스 판정을 여기 또 구현하면 markdown-it 과 두 벌이 된다.
 */
export function findLapisRanges(text: string): SyntaxRange[] {
  const out: SyntaxRange[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const c = CALLOUT_RE.exec(line);
    if (c) {
      const at = offset + line.indexOf(c[1]);
      out.push({
        from: at,
        to: at + c[1].length,
        kind: KNOWN.has(c[2].toLowerCase()) ? "callout" : "callout-unknown",
      });
    }
    EMBED_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = EMBED_RE.exec(line)) !== null) {
      out.push({ from: offset + m.index, to: offset + m.index + m[0].length, kind: "embed" });
    }
    offset += line.length + 1; // 개행 한 글자
  }
  // ⚠️ CodeMirror 의 `RangeSetBuilder` 는 **오름차순**을 요구한다. 한 줄에 콜아웃과
  //    임베드가 같이 있으면 위 순서가 뒤집힐 수 있다.
  return out.sort((a, b) => a.from - b.from);
}

/**
 * 위 구간을 CodeMirror 데코레이션으로 바꾸는 얇은 층.
 *
 * ⚠️ 문서 전체를 훑는다. 이 vault의 가장 긴 노트가 488줄이라 보이는 구간만 훑는 최적화가
 * 값을 못 한다 — 복잡도만 는다. 큰 문서를 다루게 되면 그때 `view.visibleRanges` 로 좁힌다.
 */
export function lapisSyntaxExtension(): Extension {
  const CLASS: Record<LapisSyntaxKind, string> = {
    callout: "cm-lapis-callout",
    "callout-unknown": "cm-lapis-callout-unknown",
    embed: "cm-lapis-embed",
  };

  const build = (view: EditorView) => {
    const b = new RangeSetBuilder<Decoration>();
    for (const r of findLapisRanges(view.state.doc.toString())) {
      b.add(r.from, r.to, Decoration.mark({ class: CLASS[r.kind] }));
    }
    return b.finish();
  };

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}
