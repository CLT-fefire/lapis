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
