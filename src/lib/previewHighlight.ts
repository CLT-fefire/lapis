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

export interface PreviewMatch {
  range: Range;
}

const MARK_CLASS = "lapis-search-match";
const CURRENT_CLASS = "lapis-search-current";

/**
 * root 하위 텍스트 노드를 순회하며 query에 매치되는 Range 목록을 반환.
 * 대소문자 구분 X (substring + toLowerCase).
 *
 * 이미 적용된 mark 안의 텍스트도 후보(재계산 시점에는 보통 clearHighlights가 선행되므로 mark 없음).
 */
export function findMatches(root: HTMLElement, query: string): PreviewMatch[] {
  if (!query) return [];
  const q = query.toLowerCase();
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
    const lower = text.toLowerCase();
    let from = 0;
    while (true) {
      const idx = lower.indexOf(q, from);
      if (idx === -1) break;
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + q.length);
      matches.push({ range });
      from = idx + q.length;
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
      console.warn("[lapis] highlight surroundContents failed", e);
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
