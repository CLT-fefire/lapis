import { describe, it, expect } from "vitest";
import { parseNote } from "./markdown";

/** 이 파일의 관심사는 본문 렌더다 — frontmatter 는 없다. */
const renderMarkdown = (src: string) => parseNote(src).html;

/**
 * 작업 목록 렌더.
 *
 * ⚠️ markdown-it 코어에는 작업 목록이 없다. 그래서 `- [ ] 할 일` 이 **글자 그대로**
 * `[ ] 할 일` 로 보였다 — 이 vault 에 **미완 90 · 완료 30** 이 있는데 전부 대괄호였다.
 */

describe("체크박스 렌더", () => {
  it("미완을 체크 안 된 상자로", () => {
    const html = renderMarkdown("- [ ] 할 일");
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain("checked");
    expect(html).toContain("할 일");
  });

  it("완료를 체크된 상자로", () => {
    const html = renderMarkdown("- [x] 끝난 일");
    expect(html).toContain("checked");
  });

  it("대문자 X 도 완료다", () => {
    expect(renderMarkdown("- [X] 끝")).toContain("checked");
  });

  /** ⚠️ 원문의 대괄호가 남으면 고친 뜻이 없다. */
  it("대괄호가 글자로 남지 않는다", () => {
    const html = renderMarkdown("- [ ] 할 일");
    expect(html).not.toMatch(/\[\s*\]\s*할 일/);
  });

  /**
   * 🔴 **읽기 전용이다.** `README` 가 "쓰기 도구가 아니다"라고 못 박았고, 클릭으로 파일을
   * 고치는 것은 되돌릴 수 없는 쓰기다.
   */
  it("체크박스가 disabled 다", () => {
    expect(renderMarkdown("- [ ] 할 일")).toContain("disabled");
  });

  /** 눌러도 아무 일이 없으면 고장처럼 보인다 — 이유를 남긴다. */
  it("왜 안 눌리는지 title 로 말한다", () => {
    expect(renderMarkdown("- [ ] 할 일")).toMatch(/title="[^"]*⌘E/);
  });

  /** 목록·항목에 표시가 붙어야 CSS 가 불릿을 지울 수 있다. */
  it("목록과 항목에 표시가 붙는다", () => {
    const html = renderMarkdown("- [ ] 할 일");
    expect(html).toContain("task-list");
    expect(html).toContain("task-item");
  });
});

describe("건드리면 안 되는 것", () => {
  /** ⚠️ 보통 목록은 그대로여야 한다. */
  it("일반 목록에는 상자가 없다", () => {
    const html = renderMarkdown("- 그냥 항목");
    expect(html).not.toContain("checkbox");
    expect(html).not.toContain("task-item");
  });

  /** ⚠️ 대괄호가 문장 **중간**에 있으면 작업이 아니다. */
  it("중간의 대괄호는 안 건드린다", () => {
    const html = renderMarkdown("- 앞 [ ] 뒤");
    expect(html).not.toContain("checkbox");
  });

  /** ⚠️ 링크 문법과 헷갈리면 안 된다. */
  it("링크는 그대로", () => {
    const html = renderMarkdown("- [라벨](http://example.com)");
    expect(html).not.toContain("checkbox");
    expect(html).toContain("href");
  });

  /**
   * 🔴 **인라인 토큰을 새로 만들면 안 된다.** 다시 파싱하면 위키링크·강조가 한 번 더
   * 처리되거나 아예 안 된다 — 둘 다 조용히 틀린다.
   */
  it("항목 안의 위키링크가 살아 있다", () => {
    const html = renderMarkdown("- [ ] [[다른 노트]] 를 본다");
    expect(html).toContain('type="checkbox"');
    expect(html).toMatch(/data-target="다른 노트"/);
    expect(html).not.toContain("[[다른 노트]]");
  });

  it("항목 안의 강조가 살아 있다", () => {
    const html = renderMarkdown("- [ ] **굵게**");
    expect(html).toContain("<strong>");
  });

  /** 문단(리스트 밖)의 대괄호는 작업이 아니다. */
  it("문단의 대괄호는 안 건드린다", () => {
    expect(renderMarkdown("[ ] 문단")).not.toContain("checkbox");
  });

  /** 중첩 목록에서도 각 항목이 제 표시를 받는다. */
  it("중첩 목록도 처리한다", () => {
    const html = renderMarkdown("- [ ] 부모\n  - [x] 자식");
    expect((html.match(/type="checkbox"/g) ?? [])).toHaveLength(2);
    expect(html).toContain("checked");
  });
});
