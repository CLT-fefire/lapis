/**
 * Preview 영역 (markdown-it 렌더 결과 DOM) 내부 텍스트 검색·하이라이트.
 *
 * 구현 방식: DOM <mark> 삽입.
 *   - CSS Custom Highlight API (Chromium 105+/WebKit)는 inline element가 끼인 텍스트 노드를
 *     부분적으로만 렌더하는 케이스가 있어(WKWebView 검증), 안정성이 부족.
 *   - 텍스트 노드 split + <mark> surroundContents는 모든 케이스에서 정확.
 *   - clearHighlights 시 mark를 풀고 normalize → 원본 DOM 구조 복원.
 *
 * 스타일은 +page.svelte에서 글로벌로 정의된다(.lapis-search-match / .lapis-search-current).
 */

import { logWarn } from "$lib/stores/usage";

export interface PreviewMatch {
  range: Range;
}

export interface FindOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}

const MARK_CLASS = "lapis-search-match";
const CURRENT_CLASS = "lapis-search-current";

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 옵션을 반영한 RegExp 생성. 사용자 입력이 invalid regex이면 null 반환.
 * - regex: 사용자 입력을 정규식으로 그대로 해석
 * - 일반(literal): escape 후 substring 매치
 * - caseSensitive: false면 `i` 플래그
 * - `g` 플래그는 항상 켜짐 (matchAll/lastIndex 활용)
 */
/** `\b` 가 경계로 인정하는 문자 — ASCII 낱말 문자. 한글은 여기 없다. */
const ASCII_WORD = /[A-Za-z0-9_]/;

/**
 * 이 엔진이 lookbehind 를 파싱하나.
 *
 * ⚠️ **기능 검사다.** 버전으로 가르면 틀린다 — 같은 Safari 버전이 OS 에 따라 다르고,
 * WKWebView 는 그보다 더 갈린다. 못 파싱하는 엔진에서 `new RegExp` 는 **던지고**,
 * 그러면 `buildSearchRegex` 가 `null` 을 내 **검색이 통째로 죽는다**(v3.1.1 에서 고친
 * 증상과 같아진다).
 *
 * 한 번만 재고 기억한다 — 매 키 입력마다 정규식을 컴파일할 이유가 없다.
 */
const LOOKBEHIND_OK = (() => {
  try {
    // eslint-disable-next-line prefer-regex-literals
    new RegExp("(?<![a-z])x");
    return true;
  } catch {
    return false;
  }
})();

/**
 * 낱말 문자 — **유니코드 기준**. 한글·한자·가나가 전부 들어간다.
 *
 * 이게 있어야 `고양이` 가 `검은고양이` 안에서는 안 잡힌다 — ASCII `\b` 로는
 * 표현할 수 없는 경계다.
 */
const UNI_WORD = "[\\p{L}\\p{N}_]";

/**
 * ## ⚠️ wholeWord 와 한글
 *
 * `\b` 는 **ASCII 낱말 문자**와 그 밖의 경계다. 한글은 낱말 문자가 아니라서
 * `\b고양이\b` 는 `"고양이"` 에도 **안 맞는다** — 앞뒤가 둘 다 비-낱말이라 경계가
 * 아예 없기 때문이다.
 *
 * 즉 예전 동작은 "덜 걸린다"가 아니라 **결과가 0건**이었다. 한글이 주 용도인 앱에서
 * 낱말 단위를 켜면 검색이 조용히 죽었다 — 에러도 안내도 없다.
 *
 * 그래서 **literal 모드에서는 질의의 그 끝이 ASCII 낱말 문자일 때만** 경계를 붙인다.
 * 한글 질의는 경계 없이(=부분 문자열) 돌아 결과가 나온다.
 *
 * ⚠️ 진짜 CJK 낱말 경계는 lookbehind 가 필요한데, 옛 WKWebView 가 그걸 못 파싱하면
 * **정규식이 통째로 null 이 되어** 지금 고친 증상과 똑같아진다. 타깃 하한이 올라가기
 * 전까지는 여기서 멈춘다.
 *
 * ⚠️ regex 모드는 손대지 않는다. 거기서 질의는 글자가 아니라 패턴이라, 첫 글자로
 * 경계를 판단하면 `(가|나)` 같은 입력에서 엉뚱한 결정을 한다.
 */
export function buildSearchRegex(query: string, opts: FindOptions): RegExp | null {
  if (!query) return null;
  let body = opts.regex ? query : escapeRegExp(query);
  if (opts.wholeWord) {
    if (LOOKBEHIND_OK && !opts.regex) {
      // 🔴 **진짜 낱말 경계.** 유니코드 낱말 문자를 기준으로 하므로 한글도 제대로 갈린다 —
      //    `고양이` 가 `검은고양이` 안에서는 안 잡힌다.
      body = `(?<!${UNI_WORD})(?:${body})(?!${UNI_WORD})`;
    } else {
      // 옛 엔진 폴백 — ASCII 끝에만 `\b`. 한글은 부분 문자열로 돈다(결과가 0건이
      // 되지는 않는다). regex 모드도 이쪽이다: 질의가 글자가 아니라 패턴이라 첫 글자로
      // 경계를 판단하면 `(가|나)` 같은 입력에서 엉뚱한 결정을 한다.
      const head = opts.regex || ASCII_WORD.test(query[0]) ? "\\b" : "";
      const tail = opts.regex || ASCII_WORD.test(query[query.length - 1]) ? "\\b" : "";
      body = `${head}(?:${body})${tail}`;
    }
  }
  /**
   * ⚠️ `\p{...}` 는 **`u` 플래그가 있어야** 뜻이 있다. 없으면 `p` 한 글자로 읽혀
   * 조용히 다른 것을 찾는다. 진짜 경계를 쓸 때만 켠다 — `u` 는 사용자 정규식의 일부
   * 이스케이프를 더 엄격히 보므로, regex 모드에 켜면 예전에 되던 패턴이 깨진다.
   */
  const uni = opts.wholeWord && LOOKBEHIND_OK && !opts.regex;
  const flags = (opts.caseSensitive ? "g" : "gi") + (uni ? "u" : "");
  try {
    return new RegExp(body, flags);
  } catch {
    return null;
  }
}

/**
 * root 하위 텍스트 노드를 순회하며 query에 매치되는 Range 목록을 반환.
 *
 * 옵션 미지정 시 기본은 case-insensitive substring (기존 동작 유지).
 * 매치 결과의 length가 0인 경우(예: `a*` 같은 zero-width 정규식)는 무한 루프 방지를 위해 1로 전진.
 */
export function findMatches(
  root: HTMLElement,
  query: string,
  opts: FindOptions = {},
): PreviewMatch[] {
  if (!query) return [];
  const re = buildSearchRegex(query, opts);
  if (!re) return [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return (node.nodeValue ?? "").length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const matches: PreviewMatch[] = [];
  let node = walker.nextNode() as Text | null;
  while (node) {
    const text = node.nodeValue ?? "";
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (m[0].length === 0) {
        re.lastIndex = start + 1;
        continue;
      }
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      matches.push({ range });
      if (end === start) re.lastIndex = start + 1;
    }
    node = walker.nextNode() as Text | null;
  }
  return matches;
}

/**
 * 매치 Range들을 DOM <mark>로 감싸 시각화.
 * 매치는 모두 단일 텍스트 노드 안에 있다고 가정(findMatches가 그렇게 만듦).
 *
 * 같은 텍스트 노드에 여러 매치가 있을 때를 위해 **역순으로** surroundContents.
 * (앞 매치 적용 시 노드가 split되지만, 뒤에서부터 처리하면 이미 처리된 영역은 뒤쪽이라
 *  앞 매치의 Range가 가리키는 노드/offset이 그대로 유효함.)
 */
export function applyHighlights(
  root: HTMLElement,
  matches: PreviewMatch[],
  currentIdx: number,
): void {
  clearHighlights(root);
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!;
    const isCurrent = i === currentIdx;
    const mark = document.createElement("mark");
    mark.className = isCurrent ? CURRENT_CLASS : MARK_CLASS;
    try {
      m.range.surroundContents(mark);
    } catch (e) {
      logWarn("previewHighlight", "highlight surroundContents failed", e);
    }
  }
}

/**
 * 적용된 모든 <mark>를 풀어 원본 DOM 복원. 인접 텍스트 노드 normalize.
 */
export function clearHighlights(root: HTMLElement | null): void {
  if (!root) return;
  const marks = root.querySelectorAll(
    `mark.${MARK_CLASS}, mark.${CURRENT_CLASS}`,
  );
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
  });
  // 인접 텍스트 노드 합치기 — 다음 findMatches가 정확히 작동하도록.
  if (marks.length > 0) root.normalize();
}

/**
 * 현재 매치를 컨테이너의 가운데 근처로 스크롤. 이미 뷰포트 안에 있으면 아무것도 안 함.
 *
 * 주의: 매치가 mark로 surroundContents된 상태라면 Range가 무효일 수 있다(노드 변경).
 * 그래서 caller는 적용 직후 mark element를 직접 scrollIntoView 하는 것이 더 안전하지만,
 * 여기서는 Range 호환 시그니처를 유지한다(첫 매치 자동 스크롤은 적용 전에 호출되거나
 * 새로 계산된 Range 기준).
 */
export function scrollMatchIntoView(match: PreviewMatch, container: HTMLElement): void {
  const rangeRect = match.range.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  if (rangeRect.width === 0 && rangeRect.height === 0) return;
  if (rangeRect.top >= containerRect.top && rangeRect.bottom <= containerRect.bottom) {
    return;
  }
  const offset =
    rangeRect.top - containerRect.top - container.clientHeight / 2 + rangeRect.height / 2;
  container.scrollTop += offset;
}

/**
 * 현재 매치 mark element를 컨테이너에 보이도록 스크롤. applyHighlights 적용 후 사용.
 * Range가 split 후 무효일 수 있으므로 mark element를 직접 사용한다.
 */
export function scrollCurrentMarkIntoView(
  root: HTMLElement,
  container: HTMLElement,
): void {
  const mark = root.querySelector(`mark.${CURRENT_CLASS}`) as HTMLElement | null;
  if (!mark) return;
  const markRect = mark.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  if (markRect.top >= containerRect.top && markRect.bottom <= containerRect.bottom) {
    return;
  }
  const offset =
    markRect.top - containerRect.top - container.clientHeight / 2 + markRect.height / 2;
  container.scrollTop += offset;
}
