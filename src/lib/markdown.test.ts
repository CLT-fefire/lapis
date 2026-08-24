import { describe, it, expect } from "vitest";
import { parseNote } from "./markdown";
import { slugify } from "./markdownPlugins/headingAnchor";

describe("slugify", () => {
  it("영문 → 소문자 하이픈", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });
  it("구두점 제거, 연속 하이픈 축약", () => {
    expect(slugify("Foo: Bar! -- Baz")).toBe("foo-bar-baz");
  });
  it("한글 보존", () => {
    expect(slugify("안녕 세계")).toBe("안녕-세계");
  });
  it("빈/기호만 → 'section'", () => {
    expect(slugify("!!!")).toBe("section");
    expect(slugify("")).toBe("section");
  });
});

describe("parseNote headings (아웃라인)", () => {
  it("레벨/텍스트/slug/line 추출", () => {
    const { headings } = parseNote("# A\n\n## B sub\n");
    expect(headings).toHaveLength(2);
    expect(headings[0]).toMatchObject({ level: 1, text: "A", slug: "a", line: 0 });
    expect(headings[1]).toMatchObject({
      level: 2,
      text: "B sub",
      slug: "b-sub",
      line: 2,
    });
  });

  it("frontmatter 줄 수만큼 line 보정", () => {
    const raw = "---\ntitle: x\n---\n# A\n";
    const { headings } = parseNote(raw);
    expect(headings).toHaveLength(1);
    // raw 기준: 0='---' 1='title: x' 2='---' 3='# A'
    expect(headings[0].line).toBe(3);
  });

  it("중복 slug는 -1, -2로 dedupe", () => {
    const { headings } = parseNote("# Intro\n\n# Intro\n");
    expect(headings.map((h) => h.slug)).toEqual(["intro", "intro-1"]);
  });

  it("인라인 마크업 제거된 평문 text + slug", () => {
    const { headings } = parseNote("## **Bold** title\n");
    expect(headings[0].text).toBe("Bold title");
    expect(headings[0].slug).toBe("bold-title");
  });

  it("코드펜스 안의 #는 헤딩이 아님", () => {
    const raw = "# Real\n\n```\n# fake heading\n```\n";
    const { headings } = parseNote(raw);
    expect(headings.map((h) => h.text)).toEqual(["Real"]);
  });

  it("헤딩 HTML에 id 앵커 부여", () => {
    const { html } = parseNote("## Hello World\n");
    expect(html).toContain('id="hello-world"');
  });
});

describe("코드펜스 하이라이트 — vault 실측으로 뚫린 구멍", () => {
  /**
   * 2026-08-24 실측: vault 전량의 펜스 info string을 실제 등록 목록과 대조해
   * 무색으로 그려지던 5종을 찾았다. 괄호 안은 그때의 사용 건수.
   *
   * ⚠️ 2026-08-21 감사 문서가 지목한 `jsonc`(28)는 **이미 커버돼 있었다** —
   * hljs `json`의 alias다. 지적을 그대로 믿지 않고 다시 잰 것이 이 목록이다.
   */
  //
  // ⚠️ 샘플은 **그 언어답게** 써야 한다. 전부 `let x = 1;`로 두면 http·svelte에서
  // 토큰이 하나도 안 나와, 등록이 됐는데도 실패한다(= 단언이 언어가 아니라 샘플을 잰다).
  const REGISTERED: [string, string][] = [
    ["dart", "void main() { print('hi'); }"],
    ["ruby", "def foo\n  :bar\nend"],
    ["http", "GET /api/v1 HTTP/1.1\nHost: example.com"],
    ["objective-c", "@interface Foo : NSObject\n@end"],
    ["svelte", "<script>let x = 1;</script>\n<p>{x}</p>"],
  ];

  it.each(REGISTERED)("`%s` 펜스가 토큰화된다", (lang, sample) => {
    const { html } = parseNote(`\`\`\`${lang}\n${sample}\n\`\`\`\n`);
    expect(html).toContain(`class="language-${lang}"`);
    // 토큰 span이 하나도 없으면 등록만 되고 실제로는 안 칠해진 것이다.
    expect(html).toMatch(/<span class="hljs-/);
  });

  it("등록되지 않은 언어는 escape 폴백 — 이 테스트가 위 단언의 변별력을 보증한다", () => {
    const { html } = parseNote("```brainfuck\n+++[->+++<]\n```\n");
    expect(html).not.toMatch(/<span class="hljs-/);
  });

  it("이미 alias로 커버되던 표기는 그대로 동작한다 (회귀 감시)", () => {
    for (const lang of ["jsonc", "zsh", "ts", "objc"]) {
      const { html } = parseNote(`\`\`\`${lang}\n{"a": 1}\n\`\`\`\n`);
      expect(html, lang).toContain(`class="language-${lang}"`);
    }
  });
});
