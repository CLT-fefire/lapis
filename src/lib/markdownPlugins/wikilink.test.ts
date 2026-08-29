import { describe, it, expect } from "vitest";
import MarkdownIt from "markdown-it";
import { wikilinkPlugin } from "./wikilink";

/**
 * 위키링크 **생산자**의 계약.
 *
 * ## 🔴 왜 이제야 생겼나
 *
 * 이 플러그인은 `markdown.ts` 를 통해 **실행은 되고 있었다.** 그래서 커버리지 지도에서
 * "안 닿음"으로도 안 잡혔다. 그런데 **내는 모양을 아무도 단언하지 않았다.**
 *
 * 그 틈에서 결함이 나왔다: 나란히 보기 옆칸이 `a.wikilink[data-target-path]` 를 찾았는데
 * 실제로 나오는 것은 `span.wikilink[data-target]` 이라 링크가 통째로 죽었다. 소비자 쪽에도
 * 생산자 쪽에도 계약을 못 박은 자리가 없어서 **어느 쪽도 안 울렸다.**
 *
 * ⚠️ **"실행된다"와 "계약이 고정돼 있다"는 다르다.** 커버리지 숫자는 이 차이를 못 본다.
 */

const md = new MarkdownIt().use(wikilinkPlugin);
/** 문단 껍질을 벗긴 인라인 결과. */
const inline = (src: string) => md.render(src).trim().replace(/^<p>|<\/p>$/g, "");

describe("내는 모양", () => {
  /**
   * 🔴 **`<a>` 가 아니라 `<span>` 이다.** 원본 주석의 근거: *"a 태그의 default navigation
   * 위험 회피"*. 앵커면 웹뷰가 실제로 이동해 버린다.
   */
  it("span 이고 a 가 아니다", () => {
    const html = inline("[[대상]]");
    expect(html).toContain("<span");
    expect(html, "앵커로 내면 웹뷰가 떠난다").not.toContain("<a ");
  });

  /** 🔴 소비자(`previewClick.ts`)가 읽는 이름이 정확히 이것이다. */
  it("클래스는 wikilink · 속성은 data-target", () => {
    expect(inline("[[대상]]")).toContain(`class="wikilink" data-target="대상"`);
  });

  /** 키보드로 닿아야 한다 — span 은 기본으로 초점을 못 받는다. */
  it("role 과 tabindex 를 단다", () => {
    const html = inline("[[대상]]");
    expect(html).toContain(`role="link"`);
    expect(html).toContain(`tabindex="0"`);
  });
});

describe("대상과 표시", () => {
  it("파이프가 없으면 대상이 곧 표시다", () => {
    expect(inline("[[가나]]")).toContain(">가나</span>");
  });

  it("파이프 뒤가 표시다", () => {
    const html = inline("[[경로/가나|다른 이름]]");
    expect(html).toContain(`data-target="경로/가나"`);
    expect(html).toContain(">다른 이름</span>");
  });

  it("앞뒤 공백은 턴다", () => {
    const html = inline("[[  가나  |  별칭  ]]");
    expect(html).toContain(`data-target="가나"`);
    expect(html).toContain(">별칭</span>");
  });

  /** `[[#헤딩]]` — 같은 문서 안. 푸는 것은 `jumpToWikilink` 몫이고 여기선 그대로 싣는다. */
  it("헤딩 앵커도 그대로 싣는다", () => {
    expect(inline("[[#어떤 헤딩]]")).toContain(`data-target="#어떤 헤딩"`);
  });
});

/**
 * 🔴 **본문은 신뢰할 수 없는 입력이다.** vault 의 노트는 사람이 쓰지만 붙여 넣은 것일 수
 * 있고, 결과는 `{@html}` 로 들어간다. 이스케이프가 빠지면 그대로 스크립트가 된다.
 */
describe("이스케이프", () => {
  it("대상 안의 따옴표가 속성을 못 깬다", () => {
    const html = inline(`[[a" onmouseover="x]]`);
    expect(html).not.toContain(`onmouseover="x"`);
    expect(html).toContain("&quot;");
  });

  it("표시 텍스트의 태그가 살아나지 않는다", () => {
    const html = inline("[[가|<img src=x onerror=y>]]");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("안 잡는 것", () => {
  it("대괄호 하나는 그대로 둔다", () => {
    expect(inline("[보통](x.md)")).not.toContain("wikilink");
  });

  it("닫히지 않으면 안 잡는다", () => {
    expect(inline("[[안 닫힘")).not.toContain("wikilink");
  });

  it("대상이 비면 안 만든다", () => {
    expect(inline("[[]]")).not.toContain("wikilink");
    expect(inline("[[   ]]")).not.toContain("wikilink");
  });

  /**
   * ⚠️ **중첩은 바깥을 버리고 안쪽을 잡는다.** 실측으로 알았다 — 처음엔 "둘 다 안 잡는다"고
   * 적었다가 테스트한테 틀렸다는 말을 들었다.
   *
   * 규칙은 `inner.includes("[[")` 하나다: 첫 `[[` 와 첫 `]]` 사이에 또 `[[` 가 있으면
   * 그 후보를 버린다. 그러면 파서가 앞으로 나아가다 안쪽의 온전한 것을 만나 그건 잡는다.
   * 앞의 `[[가 ` 는 **글자 그대로** 남는다 — 어느 쪽이 대상인지 정할 근거가 없을 때
   * 통째로 삼키는 것보다 낫다.
   */
  it("중첩이면 바깥은 버리고 안쪽만 잡는다", () => {
    const html = inline("[[가 [[나]]");
    expect(html).toContain(`data-target="나"`);
    expect(html, "바깥까지 삼켰다").toContain("[[가 ");
  });

  it("줄을 넘으면 안 잡는다", () => {
    expect(md.render("[[가\n나]]")).not.toContain("wikilink");
  });
});
