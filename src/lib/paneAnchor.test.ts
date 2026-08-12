import { describe, it, expect } from "vitest";
import {
  anchorForLine,
  anchorForSlug,
  sameAnchor,
  TOP_ANCHOR,
  type PaneAnchor,
} from "./paneAnchor";
import type { HeadingInfo } from "$lib/markdownPlugins/headingAnchor";

/**
 * 페인 교대 위치 이월의 **매핑 규칙**을 고정한다. DOM 측정(프리뷰 활성 헤딩 판정,
 * 픽셀 복원)은 `+page.svelte`에 남고, 여기서 지키는 건 순수 부분이다:
 * 라인 → 섹션, slug → 라인, 그리고 "같은 위치인가" 판정.
 */

function h(level: number, text: string, slug: string, line: number): HeadingInfo {
  return { level, text, slug, line };
}

// 실제 문서 모양: frontmatter 뒤 h1, 인트로 문단, 그 뒤 섹션들.
const HEADINGS: HeadingInfo[] = [
  h(1, "제목", "제목", 8),
  h(2, "설치", "설치", 14),
  h(2, "사용법", "사용법", 40),
  h(3, "옵션", "옵션", 52),
  h(2, "설치", "설치-1", 90), // 중복 텍스트 → slug에 접미사
];

describe("anchorForLine — 편집 커서 → 섹션", () => {
  const cases: Array<[string, number, PaneAnchor]> = [
    ["frontmatter 안(첫 헤딩보다 위)", 3, TOP_ANCHOR],
    ["첫 헤딩 직전", 7, TOP_ANCHOR],
    ["헤딩 줄 자체", 8, { line: 8, slug: "제목" }],
    ["섹션 본문 중간", 30, { line: 14, slug: "설치" }],
    ["하위 헤딩 직전", 51, { line: 40, slug: "사용법" }],
    ["하위 헤딩 안", 60, { line: 52, slug: "옵션" }],
    ["마지막 섹션(중복 slug)", 200, { line: 90, slug: "설치-1" }],
  ];
  for (const [name, line, expected] of cases) {
    it(name, () => {
      expect(anchorForLine(HEADINGS, line)).toEqual(expected);
    });
  }

  it("헤딩이 없는 문서는 항상 맨 위", () => {
    expect(anchorForLine([], 120)).toEqual(TOP_ANCHOR);
  });
});

describe("anchorForSlug — 프리뷰 활성 헤딩 → 라인", () => {
  it("slug를 소스 라인으로 되돌린다", () => {
    expect(anchorForSlug(HEADINGS, "옵션")).toEqual({ line: 52, slug: "옵션" });
  });

  it("중복 접미사 slug도 구분한다", () => {
    expect(anchorForSlug(HEADINGS, "설치")).toEqual({ line: 14, slug: "설치" });
    expect(anchorForSlug(HEADINGS, "설치-1")).toEqual({ line: 90, slug: "설치-1" });
  });

  it("null이면 맨 위", () => {
    expect(anchorForSlug(HEADINGS, null)).toEqual(TOP_ANCHOR);
  });

  it("다른 문서의 slug(노트 전환 잔여)는 맨 위로 폴백", () => {
    expect(anchorForSlug(HEADINGS, "없는-헤딩")).toEqual(TOP_ANCHOR);
  });
});

describe("sameAnchor — 왕복 시 픽셀 복원 판정", () => {
  it("같은 섹션이면 true (앵커 점프 대신 px 복원)", () => {
    expect(sameAnchor({ line: 14, slug: "설치" }, { line: 14, slug: "설치" })).toBe(true);
  });

  it("맨 위끼리도 true", () => {
    expect(sameAnchor(TOP_ANCHOR, { line: 0, slug: null })).toBe(true);
  });

  it("다른 섹션이면 false (앵커 점프)", () => {
    expect(sameAnchor({ line: 14, slug: "설치" }, { line: 40, slug: "사용법" })).toBe(false);
  });

  it("맨 위 vs 섹션은 false", () => {
    expect(sameAnchor(TOP_ANCHOR, { line: 8, slug: "제목" })).toBe(false);
  });

  it("기록이 없으면(null) false — 첫 진입은 앵커 점프", () => {
    expect(sameAnchor(null, { line: 8, slug: "제목" })).toBe(false);
    expect(sameAnchor(null, null)).toBe(false);
  });
});
