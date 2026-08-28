import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripAppOnlyNodes } from "./previewExportDoc";

/**
 * 내보낼 문서에서 **앱에서만 뜻이 있는 것**을 걷어낸다.
 *
 * ## 🔴 검색어가 파일에 박제되면 안 된다
 *
 * `⌘F` 는 본문에 `<mark class="lapis-search-match">` 를 심는다. 그대로 내보내면
 * **내보낸 순간 무엇을 찾고 있었는지가 파일에 남는다.** 남에게 보내는 파일이면 특히
 * 곤란하고, 에러가 안 나므로 본인도 모른다 — 이 저장소가 경계하는 조용한 실패다.
 *
 * `previewExport.ts` 는 캔버스·파일 대화상자가 붙어 있어 happy-dom 에서 "안 돌았는데
 * 통과"가 된다. 그래서 이 함수만 `previewExportDoc.ts` 로 내려놨다.
 */

function root(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html; // 테스트 고정 문자열 — 외부 입력이 아니다
  return el;
}

describe("검색 하이라이트", () => {
  it("mark 를 벗기고 글자는 남긴다", () => {
    const el = root('<p>앞 <mark class="lapis-search-match">비밀검색어</mark> 뒤</p>');
    stripAppOnlyNodes(el);
    expect(el.querySelector("mark"), "검색어가 문서에 박제된다").toBeNull();
    expect(el.textContent).toBe("앞 비밀검색어 뒤");
  });

  it("현재 일치(current)도 벗긴다", () => {
    const el = root('<p><mark class="lapis-search-current">가</mark></p>');
    stripAppOnlyNodes(el);
    expect(el.querySelector("mark")).toBeNull();
    expect(el.textContent).toBe("가");
  });

  it("여러 개를 전부 벗긴다", () => {
    const el = root(
      '<p><mark class="lapis-search-match">가</mark>x' +
        '<mark class="lapis-search-current">나</mark>y' +
        '<mark class="lapis-search-match">다</mark></p>',
    );
    stripAppOnlyNodes(el);
    expect(el.querySelectorAll("mark")).toHaveLength(0);
    expect(el.textContent).toBe("가x나y다");
  });

  /** ⚠️ 안에 요소가 든 경우에도 통째로 지우면 안 된다. */
  it("mark 안의 요소도 살린다", () => {
    const el = root('<p><mark class="lapis-search-match">가<code>나</code></mark></p>');
    stripAppOnlyNodes(el);
    expect(el.querySelector("code")?.textContent).toBe("나");
  });

  /** 사용자가 본문에 직접 쓴 `<mark>` 는 **남긴다** — 그건 문서의 일부다. */
  it("본문의 일반 mark 는 건드리지 않는다", () => {
    const el = root("<p><mark>강조</mark></p>");
    stripAppOnlyNodes(el);
    expect(el.querySelector("mark")?.textContent).toBe("강조");
  });
});

describe("앱 전용 버튼", () => {
  it("mermaid 내보내기 버튼을 지운다", () => {
    const el = root('<div class="mermaid"><button class="mermaid-export-btn">PNG</button><svg></svg></div>');
    stripAppOnlyNodes(el);
    expect(el.querySelector(".mermaid-export-btn"), "정적 문서에서 눌러도 아무 일이 없다").toBeNull();
    expect(el.querySelector("svg"), "다이어그램까지 지우면 안 된다").not.toBeNull();
  });

  it("걷어낼 것이 없어도 안 죽는다", () => {
    const el = root("<p>보통 문서</p>");
    expect(() => stripAppOnlyNodes(el)).not.toThrow();
    expect(el.textContent).toBe("보통 문서");
  });
});

/**
 * ⚠️ **호출부가 실제로 부르는가.** 순수 함수가 초록이어도 내보내기 경로가 안 부르면
 * 검색어는 그대로 나간다 — 에러 없이.
 */
describe("배선", () => {
  // ⚠️ `import.meta.url` 은 dom 프로젝트(happy-dom)에서 file: 스킴이 아니다.
  //    vitest 는 레포 루트에서 도므로 상대 경로가 안전하다.
  const src = readFileSync("src/lib/previewExport.ts", "utf-8");

  it("내보내기가 이 함수를 부른다", () => {
    expect(src).toMatch(/stripAppOnlyNodes,?\s*\n?\s*\}? from "\$lib\/previewExportDoc"|stripAppOnlyNodes,/);
    expect(src).toMatch(/stripAppOnlyNodes\(clone\)/);
  });

  /** ⚠️ **clone 위에서만** 부른다. 원본에 부르면 화면의 검색 표시가 사라진다. */
  it("원본이 아니라 clone 에 부른다", () => {
    expect(src, "원본 root 에 부르면 화면이 망가진다").not.toMatch(/stripAppOnlyNodes\(root\)/);
  });

  it("함수가 두 벌이 아니다", () => {
    expect(src, "옛 사본이 남아 있다").not.toMatch(/function stripAppOnlyNodes/);
  });
});
