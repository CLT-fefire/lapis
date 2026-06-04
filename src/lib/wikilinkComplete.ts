import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";

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
 * 위키링크 자동완성 CodeMirror 확장.
 * getCandidates는 호출 시점에 최신 vault 노트 목록을 반환(클로저로 store를 읽음).
 */
export function wikilinkCompletionExtension(
  getCandidates: () => WikilinkCandidate[],
): Extension {
  const source: CompletionSource = (
    context: CompletionContext,
  ): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = context.state.sliceDoc(line.from, context.pos);
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

  return autocompletion({
    override: [source],
    activateOnTyping: true,
    icons: false,
  });
}
