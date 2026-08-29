import { describe, it, expect } from "vitest";
import MarkdownIt from "markdown-it";
import { lapisQueryPlugin } from "./lapisQuery";
import { mermaidPlugin } from "./mermaid";

/**
 * ` ```lapis-query ` fence → 자리(host).
 *
 * 🔴 **mermaid 와 같은 자리(`renderer.rules.fence`)를 가로챈다.** 둘 다 자기 것만 잡고
 * 나머지는 앞 렌더러에 넘겨야 한다 — 안 그러면 한쪽을 넣는 순간 다른 쪽 코드블록이
 * **조용히 사라진다.** 그래서 둘을 같이 물려 두고 잰다.
 */

const md = new MarkdownIt().use(mermaidPlugin).use(lapisQueryPlugin);
const fence = (info: string, body: string) => md.render("```" + info + "\n" + body + "\n```");

describe("자리를 만든다", () => {
  it("lapis-query 는 host 가 된다", () => {
    const html = fence("lapis-query", "doc_kind: plan");
    expect(html).toContain('class="lapis-query-host"');
    // ⚠️ 본문은 fence 가 준 그대로다(끝의 줄바꿈 포함) — mermaid 와 같다.
    //    다듬는 일은 파서 몫이고, 여기서 다듬으면 규칙이 두 곳이 된다.
    expect(html).toContain("doc_kind: plan");
  });

  it("대소문자를 안 가린다", () => {
    expect(fence("LAPIS-QUERY", "doc_kind: plan")).toContain("lapis-query-host");
  });

  /** ⚠️ 본문은 속성에 들어간다 — 따옴표가 새면 마크업이 깨진다. */
  it("본문의 따옴표가 속성을 못 깬다", () => {
    const html = fence("lapis-query", 'text: "가" onx=1');
    expect(html).not.toContain("onx=1\"");
    expect(html).toContain("&quot;");
  });
});

describe("🔴 남의 fence 를 안 먹는다", () => {
  it("mermaid 는 그대로 mermaid 다", () => {
    const html = fence("mermaid", "graph TD; A-->B;");
    expect(html).toContain("mermaid-host");
    expect(html).not.toContain("lapis-query-host");
  });

  it("평범한 코드블록은 코드블록이다", () => {
    const html = fence("ts", "const a = 1;");
    expect(html).toContain("<code");
    expect(html).not.toContain("lapis-query-host");
  });

  it("info 가 없는 fence 도 살아남는다", () => {
    const html = fence("", "그냥 글");
    expect(html).toContain("<code");
    expect(html).not.toContain("lapis-query-host");
  });

  /** ⚠️ 비슷한 이름에 걸리면 안 된다. */
  it("lapis-query-x 는 아니다", () => {
    expect(fence("lapis-query-x", "doc_kind: plan")).not.toContain("lapis-query-host");
  });
});
