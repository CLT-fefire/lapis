import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { HeadingInfo } from "$lib/markdownPlugins/headingAnchor";

/** 자동완성 후보 1건 — vault 노트 하나. */
export interface WikilinkCandidate {
  /** 파일 stem(확장자 제외 파일명). 실제 삽입되는 값. */
  stem: string;
  /** frontmatter title(없으면 null). detail 표시용. */
  title: string | null;
  /** frontmatter aliases — 매칭 대상에 포함. */
  aliases: string[];
  /** 동일 stem 구분용 보조 텍스트(예: 부모 폴더명). */
  rel?: string;
}

export interface PrefixMatch {
  /** textBefore 내 query 시작 오프셋(`[[` 바로 다음). */
  from: number;
  /** `[[` 이후 입력된 검색어(원본 대소문자 유지). */
  query: string;
}

// `[[` 이후 `]` `[` 개행 `|` 가 없는 구간을 커서 직전까지 캡처.
// `|` 제외 → `[[stem|별칭` 입력 중엔 자동완성 비활성(별칭은 자유 입력).
const WIKILINK_PREFIX = /\[\[([^[\]\n|]*)$/;

/**
 * 커서 앞 텍스트(줄 시작~커서)에서 위키링크 자동완성 트리거 구간을 찾는다.
 * 매칭 없으면 null.
 */
export function matchWikilinkPrefix(textBefore: string): PrefixMatch | null {
  const m = WIKILINK_PREFIX.exec(textBefore);
  if (!m) return null;
  return { from: m.index + 2, query: m[1] };
}

export interface AnchorPrefix {
  /** textBefore 내 질의 시작 오프셋(`#` 바로 다음). */
  from: number;
  /** `[[` 와 `#` 사이의 노트 이름. `[[#헤딩]]`이면 빈 문자열이다. */
  note: string;
  /** `#` 이후 입력된 헤딩 검색어. */
  query: string;
}

// `[[` 이후 `#` 이 나오고, 그 뒤로 `]` `[` 개행 `|` 가 없는 구간.
// ⚠️ 노트 이름 쪽에서 `#` 을 뺀다 — 그래야 **첫 `#`** 에서 갈린다(헤딩 텍스트에 `#`이
//    또 있을 수 있다).
const ANCHOR_PREFIX = /\[\[([^[\]\n|#]*)#([^[\]\n|]*)$/;

/**
 * `[[노트#헤` 형태의 헤딩 자동완성 구간.
 *
 * ## ⚠️ 왜 따로 있나
 *
 * #246이 앵커 **문법**을 만들었는데 **입력**을 안 만들었다. `matchWikilinkPrefix`가 `#`을
 * 이름의 일부로 봐서 `[[노트#헤` 의 질의가 `노트#헤` 가 되고 **후보가 0이 된다** —
 * 헤딩 이름을 정확히 외워 손으로 쳐야 한다는 뜻이고, 그러면 아무도 안 쓴다.
 *
 * ⚠️ 이쪽이 **먼저** 검사된다. 노트가 해소되지 않으면 이름 완성으로 떨어지므로,
 * `C#.md` 같은 이름도 여전히 완성된다(해소 규칙과 같은 우선순위 — `resolverKey` 참조).
 */
export function matchAnchorPrefix(textBefore: string): AnchorPrefix | null {
  const m = ANCHOR_PREFIX.exec(textBefore);
  if (!m) return null;
  return { from: m.index + 2 + m[1].length + 1, note: m[1], query: m[2] };
}

/** 헤딩 후보를 고르고 정렬한다. 접두 일치가 부분 일치보다 위. */
export function buildHeadingCompletions(
  query: string,
  headings: readonly HeadingInfo[],
): Completion[] {
  const q = query.toLowerCase();
  const scored: { h: HeadingInfo; score: number }[] = [];
  for (const h of headings) {
    if (q === "") {
      scored.push({ h, score: 0 });
      continue;
    }
    const idx = h.text.toLowerCase().indexOf(q);
    if (idx === 0) scored.push({ h, score: 2 });
    else if (idx > 0) scored.push({ h, score: 1 });
  }
  // ⚠️ 동점은 **문서 순서**로 둔다. 알파벳순으로 섞으면 목차와 순서가 달라져
  //    "위에서 세 번째"라는 기억이 안 통한다.
  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ h, score }) => ({
    label: h.text,
    // 레벨을 낸다 — 같은 낱말이 h2와 h4에 다 있으면 어느 쪽인지 알아야 한다.
    detail: `h${h.level}`,
    type: "property",
    boost: score === 2 ? 1 : 0,
    apply: (view: EditorViewLike, _c: Completion, from: number, to: number) => {
      const afterTwo = view.state.sliceDoc(to, to + 2);
      const { insert, cursorRel } = computeAnchorInsert(h.text, afterTwo);
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + cursorRel },
      });
    },
  }));
}

/** 헤딩을 고르면 넣는 것. 이름 완성과 같은 규칙(닫는 괄호 중복 안 함). */
export function computeAnchorInsert(
  heading: string,
  afterTwo: string,
): { insert: string; cursorRel: number } {
  const hasClosing = afterTwo === "]]";
  return {
    insert: heading + (hasClosing ? "" : "]]"),
    cursorRel: heading.length + 2,
  };
}

/** `apply` 가 쓰는 최소 인터페이스 — 테스트가 CodeMirror 없이 부를 수 있게. */
interface EditorViewLike {
  state: { sliceDoc(from: number, to: number): string };
  dispatch(spec: unknown): void;
}

/**
 * 후보 선택 시 삽입 문자열 + 커서 상대 위치 계산.
 * - afterTwo: 치환 구간(to) 바로 뒤 2글자. 이미 `]]`면 닫는 괄호 중복 안 함.
 * - cursorRel: 치환 시작(from) 기준 커서 오프셋 → 항상 `]]` 뒤.
 */
export function computeWikilinkInsert(
  stem: string,
  afterTwo: string,
): { insert: string; cursorRel: number } {
  const hasClosing = afterTwo === "]]";
  const insert = stem + (hasClosing ? "" : "]]");
  return { insert, cursorRel: stem.length + 2 };
}

/** query(소문자)와 후보의 매칭 점수. 접두 일치 2 / 부분 일치 1 / 불일치 -1. */
function scoreCandidate(query: string, c: WikilinkCandidate): number {
  if (query === "") return 0;
  const hay = [c.stem, c.title ?? "", ...c.aliases];
  let best = -1;
  for (const h of hay) {
    if (!h) continue;
    const idx = h.toLowerCase().indexOf(query);
    if (idx === 0) best = Math.max(best, 2);
    else if (idx > 0) best = Math.max(best, 1);
  }
  return best;
}

function toCompletion(c: WikilinkCandidate): Completion {
  const detail =
    c.title && c.title.toLowerCase() !== c.stem.toLowerCase() ? c.title : c.rel;
  return {
    label: c.stem,
    detail: detail ?? undefined,
    type: "text",
    apply: (view, _completion, from, to) => {
      const afterTwo = view.state.sliceDoc(to, to + 2);
      const { insert, cursorRel } = computeWikilinkInsert(c.stem, afterTwo);
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + cursorRel },
      });
    },
  };
}

/**
 * query로 후보를 필터·정렬해 Completion[] 반환.
 * 접두 일치 > 부분 일치, 동점은 stem 알파벳 순.
 */
export function buildWikilinkCompletions(
  query: string,
  candidates: WikilinkCandidate[],
): Completion[] {
  const q = query.toLowerCase();
  const scored: { c: WikilinkCandidate; score: number }[] = [];
  for (const c of candidates) {
    const score = scoreCandidate(q, c);
    if (score >= 0) scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score || a.c.stem.localeCompare(b.c.stem));
  return scored.map(({ c, score }) => ({
    ...toCompletion(c),
    boost: score === 2 ? 1 : 0,
  }));
}

/**
 * 자동완성 **소스**만 따로 낸다 — `autocompletion()` 으로 감싸기 전 단계.
 *
 * ⚠️ 확장으로 감싼 채로는 **분기 순서를 테스트할 수 없다.** 실제로 앵커 분기를 통째로
 * 껐는데 순수 함수 테스트 16건이 전부 통과했다. 그건 "만들었는데 안 쓴다"를 못 잡는다.
 */
export function makeWikilinkCompletionSource(
  getCandidates: () => WikilinkCandidate[],
  /**
   * 노트 이름 → 그 노트의 헤딩. 모르는 이름이면 `null`.
   *
   * ⚠️ 빈 이름(`[[#헤딩]]`)은 **지금 문서**를 뜻한다. 호출부가 그렇게 다뤄야 한다 —
   * 여기서 판단하면 편집 중인 버퍼를 모르는 채로 디스크를 읽게 된다.
   *
   * 없으면 헤딩 완성이 꺼진다(이름 완성은 그대로 돈다).
   */
  getHeadings?: (note: string) => Promise<readonly HeadingInfo[] | null>,
): CompletionSource {
  return async (
    context: CompletionContext,
  ): Promise<CompletionResult | null> => {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = context.state.sliceDoc(line.from, context.pos);

    // ⚠️ 앵커를 **먼저** 본다. 노트가 해소되지 않으면 아래 이름 완성으로 떨어지므로,
    //    `C#.md` 같은 이름도 여전히 완성된다 — 해소 규칙(`resolverKey`)과 같은 순서다.
    const ap = matchAnchorPrefix(textBefore);
    if (ap && getHeadings) {
      const headings = await getHeadings(ap.note);
      if (headings) {
        const options = buildHeadingCompletions(ap.query, headings);
        if (options.length === 0) return null;
        return { from: line.from + ap.from, options, filter: false };
      }
    }

    const pm = matchWikilinkPrefix(textBefore);
    if (!pm) return null;
    const options = buildWikilinkCompletions(pm.query, getCandidates());
    if (options.length === 0) return null;
    return {
      from: line.from + pm.from,
      options,
      filter: false, // 점수 정렬을 우리가 직접 수행 → CodeMirror 재필터 끔
    };
  };
}

/**
 * 위키링크 자동완성 CodeMirror 확장.
 * getCandidates는 호출 시점에 최신 vault 노트 목록을 반환(클로저로 store를 읽음).
 */
export function wikilinkCompletionExtension(
  getCandidates: () => WikilinkCandidate[],
  getHeadings?: (note: string) => Promise<readonly HeadingInfo[] | null>,
): Extension {
  return autocompletion({
    override: [makeWikilinkCompletionSource(getCandidates, getHeadings)],
    activateOnTyping: true,
    icons: false,
  });
}
