import { describe, it, expect } from "vitest";
import { EXPORT_BASE_CSS, buildHtmlDocument } from "./previewExportDoc";

/**
 * 인쇄 규칙.
 *
 * ## ⚠️ PDF 라이브러리를 안 들인다
 *
 * 자립 HTML 은 이미 있고 브라우저는 어디에나 있다. 라이브러리를 들이면 글꼴·CJK·수식이
 * 전부 우리 문제가 된다. `@media print` 한 장이 같은 결과를 낸다.
 *
 * ## 🔴 종이에서 조용히 사라지는 것들
 *
 * 화면에서는 가로로 스크롤하는 코드 블록이 종이에는 **잘려서 그냥 없어진다.** 링크는
 * 눌러도 아무 일이 없다. 둘 다 인쇄한 사람이 나중에야 안다.
 */

describe("내보낸 문서의 인쇄 규칙", () => {
  it("인쇄 규칙이 들어 있다", () => {
    expect(EXPORT_BASE_CSS).toMatch(/@media print/);
  });

  /** 🔴 코드가 잘리면 그냥 사라진다 — 스크롤이 없는 매체다. */
  it("코드 블록을 접는다", () => {
    expect(EXPORT_BASE_CSS).toMatch(/white-space: pre-wrap/);
  });

  /** 🔴 종이에서 링크는 눌러도 아무 일이 없다 — 주소가 보여야 한다. */
  it("바깥 링크의 주소를 뒤에 붙인다", () => {
    expect(EXPORT_BASE_CSS).toMatch(/a\[href\^="http"\]::after/);
    expect(EXPORT_BASE_CSS).toMatch(/attr\(href\)/);
  });

  /** ⚠️ 내부 링크의 `#슬러그` 는 읽는 사람에게 뜻이 없다. */
  it("내부 링크에는 안 붙인다", () => {
    expect(EXPORT_BASE_CSS).toMatch(/a:not\(\[href\^="http"\]\)::after/);
    expect(EXPORT_BASE_CSS).toMatch(/content: none/);
  });

  it("표·코드·그림이 쪼개지지 않게 한다", () => {
    expect(EXPORT_BASE_CSS).toMatch(/break-inside: avoid/);
    // 옛 브라우저용 별칭도 같이 — 하나만 두면 조용히 안 먹는다.
    expect(EXPORT_BASE_CSS).toMatch(/page-break-inside: avoid/);
  });

  it("제목이 페이지 끝에 혼자 안 남게 한다", () => {
    expect(EXPORT_BASE_CSS).toMatch(/break-after: avoid/);
  });

  /** ⚠️ 화면 배경을 그대로 인쇄하면 토너를 붓는다. */
  it("종이는 하얗게", () => {
    const printBlock = EXPORT_BASE_CSS.slice(EXPORT_BASE_CSS.indexOf("@media print"));
    expect(printBlock).toMatch(/background: #ffffff/);
  });
});

describe("실제 문서에 실린다", () => {
  it("내보낸 HTML 이 인쇄 규칙을 담는다", () => {
    const html = buildHtmlDocument({
      title: "제목",
      bodyHtml: "<p>본문</p>",
      tokenBlock: ":root{}",
      renderedCss: "",
    });
    expect(html).toMatch(/@media print/);
  });
});
