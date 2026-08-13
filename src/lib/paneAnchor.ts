import type { HeadingInfo } from "$lib/markdownPlugins/headingAnchor";

/**
 * 읽기↔편집 페인 교대(⌘E) 때 **위치를 옮기는 앵커**.
 *
 * 두 페인은 좌표계가 다르다 — 프리뷰는 렌더된 픽셀, 에디터는 소스 라인. 픽셀은
 * 서로 환산할 수 없다(코드펜스·표·mermaid는 소스 한 줄이 렌더 수백 px이 된다).
 * 그래서 공통 기준으로 **헤딩**을 쓴다: 헤딩만이 양쪽에 동시에 존재하고
 * (프리뷰는 `id` 앵커, 에디터는 소스 라인) `parseNote`가 이미 둘을 한 객체로 들고 있다.
 *
 * ⚠️ 정밀도는 **섹션 단위**다. 섹션 하나가 길면 읽던 줄이 아니라 섹션 머리로 간다.
 * 줄 단위로 가려면 markdown-it `token.map`을 렌더 블록의 `data-line`으로 심어야 하는데
 * 그건 별건이다.
 */
export interface PaneAnchor {
  /** 0-based 소스 라인 (raw 기준 = frontmatter 포함). 에디터 점프 대상. */
  line: number;
  /** 프리뷰 헤딩 `id`. `null`이면 첫 헤딩보다 위 = 문서 맨 위. */
  slug: string | null;
}

/** 첫 헤딩보다 위 = 문서 맨 위. 헤딩이 아예 없는 문서도 항상 이 값이 된다. */
export const TOP_ANCHOR: PaneAnchor = { line: 0, slug: null };

/**
 * 소스 라인이 속한 섹션의 앵커 (편집 → 읽기 방향).
 * 커서가 첫 헤딩보다 위면 문서 맨 위.
 */
export function anchorForLine(headings: HeadingInfo[], line: number): PaneAnchor {
  let found: PaneAnchor = TOP_ANCHOR;
  for (const h of headings) {
    // headings는 markdown-it 토큰 순서 = 문서 순서 → line 오름차순이 보장된다.
    if (h.line > line) break;
    found = { line: h.line, slug: h.slug };
  }
  return found;
}

/**
 * 프리뷰 활성 헤딩 slug → 앵커 (읽기 → 편집 방향).
 * slug가 없거나(맨 위) 현재 문서에 없으면 문서 맨 위.
 */
export function anchorForSlug(
  headings: HeadingInfo[],
  slug: string | null,
): PaneAnchor {
  if (!slug) return TOP_ANCHOR;
  const h = headings.find((x) => x.slug === slug);
  return h ? { line: h.line, slug: h.slug } : TOP_ANCHOR;
}

/**
 * 같은 위치를 가리키는가. slug는 `headingAnchorPlugin`이 중복 접미사(`-1`, `-2`)로
 * 유일하게 만들어 주므로 slug 비교만으로 충분하다(`null`끼리 = 둘 다 문서 맨 위).
 *
 * **이 비교가 필요한 이유**: 앵커 점프는 섹션 *머리로* 튄다. 상대 페인에서 위치가
 * 옮겨지지 않았는데도 앵커를 적용하면 ⌘E를 왕복한 것만으로 읽던 줄을 잃는다.
 * 같은 섹션이면 앵커를 무시하고 떠날 때의 픽셀 위치를 그대로 복원한다.
 */
export function sameAnchor(a: PaneAnchor | null, b: PaneAnchor | null): boolean {
  if (!a || !b) return false;
  return a.slug === b.slug;
}
