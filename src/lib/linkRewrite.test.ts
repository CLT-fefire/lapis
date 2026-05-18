import { describe, it, expect } from "vitest";
import { rewriteLinksInNote, computeLinkRewritePreview } from "$lib/linkRewrite";

/**
 * 자동 링크 갱신 단위 테스트.
 *
 * 1차 목적: 현재 동작 골든 락 (회귀 방지). 안전망 추가/파서 정밀화 등
 * 후속 변경 시 의도된 동작이 깨지지 않는지 빠르게 검증.
 *
 * 2차 목적: edge case 보강(`~~~` fence / double backtick) 검증.
 */

describe("rewriteLinksInNote — 기본 4종 패턴", () => {
  it("wikilink 단일", () => {
    const r = rewriteLinksInNote("see [[oldStem]] here", "oldStem", "newStem");
    expect(r.changed).toBe(true);
    expect(r.occurrences).toBe(1);
    expect(r.newContent).toBe("see [[newStem]] here");
  });

  it("wikilink alias 보존", () => {
    const r = rewriteLinksInNote(
      "see [[oldStem|My Title]] here",
      "oldStem",
      "newStem",
    );
    expect(r.changed).toBe(true);
    expect(r.occurrences).toBe(1);
    expect(r.newContent).toBe("see [[newStem|My Title]] here");
  });

  it("md link 기본", () => {
    const r = rewriteLinksInNote("[text](oldStem.md)", "oldStem", "newStem");
    expect(r.changed).toBe(true);
    expect(r.occurrences).toBe(1);
    expect(r.newContent).toBe("[text](newStem.md)");
  });

  it("md link path prefix 보존", () => {
    const r = rewriteLinksInNote(
      "[text](sub/dir/oldStem.md)",
      "oldStem",
      "newStem",
    );
    expect(r.changed).toBe(true);
    expect(r.newContent).toBe("[text](sub/dir/newStem.md)");
  });

  it("md link anchor 보존", () => {
    const r = rewriteLinksInNote(
      "[text](oldStem.md#section-1)",
      "oldStem",
      "newStem",
    );
    expect(r.changed).toBe(true);
    expect(r.newContent).toBe("[text](newStem.md#section-1)");
  });

  it("동일 stem (no-op)", () => {
    const r = rewriteLinksInNote("[[stem]] [text](stem.md)", "stem", "stem");
    expect(r.changed).toBe(false);
    expect(r.occurrences).toBe(0);
  });

  it("매치 없음", () => {
    const r = rewriteLinksInNote("nothing here", "oldStem", "newStem");
    expect(r.changed).toBe(false);
    expect(r.occurrences).toBe(0);
  });

  it("한 노트에 여러 매치", () => {
    const r = rewriteLinksInNote(
      "[[oldStem]] and [[oldStem|alias]] and [text](oldStem.md)",
      "oldStem",
      "newStem",
    );
    expect(r.changed).toBe(true);
    expect(r.occurrences).toBe(3);
    expect(r.newContent).toBe(
      "[[newStem]] and [[newStem|alias]] and [text](newStem.md)",
    );
  });
});

describe("rewriteLinksInNote — frontmatter related", () => {
  it("inline `related: [a, b]`", () => {
    const raw = `---
title: Test
related: [oldStem, other]
---

body`;
    const r = rewriteLinksInNote(raw, "oldStem", "newStem");
    expect(r.changed).toBe(true);
    expect(r.occurrences).toBe(1);
    expect(r.newContent).toContain("related: [newStem, other]");
  });

  it("inline quoted `related: ['oldStem', 'other']`", () => {
    const raw = `---
related: ['oldStem', 'other']
---
body`;
    const r = rewriteLinksInNote(raw, "oldStem", "newStem");
    expect(r.changed).toBe(true);
    expect(r.newContent).toContain("'newStem'");
  });

  it("multiline `related:\\n  - a`", () => {
    const raw = `---
title: Test
related:
  - oldStem
  - other
---

body`;
    const r = rewriteLinksInNote(raw, "oldStem", "newStem");
    expect(r.changed).toBe(true);
    expect(r.occurrences).toBe(1);
    expect(r.newContent).toContain("- newStem");
    expect(r.newContent).toContain("- other");
  });
});

describe("rewriteLinksInNote — 코드 보호", () => {
  it("백틱 코드 펜스 안의 wikilink는 무시", () => {
    const raw = `text [[oldStem]] visible

\`\`\`
[[oldStem]] in fence
\`\`\`

[[oldStem]] visible too`;
    const r = rewriteLinksInNote(raw, "oldStem", "newStem");
    // 펜스 밖 2건만 치환됨
    expect(r.occurrences).toBe(2);
    expect(r.newContent).toContain("[[oldStem]] in fence");
    // 펜스 바깥은 갱신
    const occurrencesOfNew = (r.newContent.match(/\[\[newStem\]\]/g) ?? []).length;
    expect(occurrencesOfNew).toBe(2);
  });

  it("백틱 코드 펜스 안의 md link도 무시", () => {
    const raw = `\`\`\`
[text](oldStem.md)
\`\`\`

[text](oldStem.md)`;
    const r = rewriteLinksInNote(raw, "oldStem", "newStem");
    expect(r.occurrences).toBe(1);
    expect(r.newContent).toContain("[text](oldStem.md)\n```");
    expect(r.newContent).toMatch(/\[text\]\(newStem\.md\)$/);
  });

  it("인라인 코드 안의 wikilink는 무시", () => {
    const r = rewriteLinksInNote(
      "real [[oldStem]] and code `[[oldStem]]`",
      "oldStem",
      "newStem",
    );
    expect(r.occurrences).toBe(1);
    expect(r.newContent).toBe("real [[newStem]] and code `[[oldStem]]`");
  });
});

describe("rewriteLinksInNote — 정규식 escape", () => {
  it("stem에 정규식 메타문자 포함해도 안전", () => {
    // 사용자가 실제로 이런 stem을 만들 일은 거의 없지만 escape 검증.
    const r = rewriteLinksInNote(
      "[[a.b+c]] and [text](a.b+c.md)",
      "a.b+c",
      "newName",
    );
    expect(r.occurrences).toBe(2);
    expect(r.newContent).toContain("[[newName]]");
    expect(r.newContent).toContain("(newName.md)");
  });

  it("한국어 stem", () => {
    const r = rewriteLinksInNote(
      "[[한글노트]] and [본문](한글노트.md)",
      "한글노트",
      "새이름",
    );
    expect(r.occurrences).toBe(2);
    expect(r.newContent).toContain("[[새이름]]");
    expect(r.newContent).toContain("(새이름.md)");
  });
});

describe("rewriteLinksInNote — edge case 보강 (옵션 2)", () => {
  it("~~~ 코드 펜스 안 wikilink 보호", () => {
    const raw = `before [[oldStem]] visible

~~~
[[oldStem]] in tilde fence
~~~

after [[oldStem]]`;
    const r = rewriteLinksInNote(raw, "oldStem", "newStem");
    expect(r.occurrences).toBe(2);
    expect(r.newContent).toContain("[[oldStem]] in tilde fence");
    const newMatches = (r.newContent.match(/\[\[newStem\]\]/g) ?? []).length;
    expect(newMatches).toBe(2);
  });

  it("~~~ 코드 펜스 안 md link 보호", () => {
    const raw = `~~~
[text](oldStem.md)
~~~

[text](oldStem.md)`;
    const r = rewriteLinksInNote(raw, "oldStem", "newStem");
    expect(r.occurrences).toBe(1);
    expect(r.newContent).toContain("[text](oldStem.md)\n~~~");
  });

  it("double backtick inline code 안 wikilink 보호 (안에 single backtick 포함)", () => {
    // Markdown: `` `code with backtick` ``  — double backtick은 내부에 single backtick 허용
    const r = rewriteLinksInNote(
      "real [[oldStem]] and ``code with [[oldStem]] and ` backtick`` end",
      "oldStem",
      "newStem",
    );
    // 첫 [[oldStem]]만 매치 — double backtick 안의 두 번째는 보호
    expect(r.occurrences).toBe(1);
    expect(r.newContent).toContain("[[newStem]]");
    expect(r.newContent).toContain("[[oldStem]] and ` backtick");
  });

  it("double backtick inline code 열고 닫기 (single backtick close 안 됨)", () => {
    // ``...` 식으로 single backtick으로 닫으려 하면 닫히지 않음 → 모든 게 code 안
    const r = rewriteLinksInNote(
      "before ``[[oldStem]] still code` end",
      "oldStem",
      "newStem",
    );
    // unclosed double backtick → 라인 끝까지 code 상태로 간주, 매치 0
    expect(r.occurrences).toBe(0);
    expect(r.newContent).toBe("before ``[[oldStem]] still code` end");
  });
});

describe("rewriteLinksInNote — 부분 매치 회피", () => {
  it("oldStem이 다른 단어의 prefix여도 정확한 token만 매치", () => {
    // `[[oldStemExtra]]`는 매치하면 안 됨.
    const r = rewriteLinksInNote(
      "[[oldStem]] and [[oldStemExtra]]",
      "oldStem",
      "newStem",
    );
    expect(r.occurrences).toBe(1);
    expect(r.newContent).toBe("[[newStem]] and [[oldStemExtra]]");
  });

  it("md link에서 oldStem이 다른 stem의 일부면 매치 X", () => {
    const r = rewriteLinksInNote(
      "[text](oldStem.md) and [text](oldStemExtra.md)",
      "oldStem",
      "newStem",
    );
    expect(r.occurrences).toBe(1);
    expect(r.newContent).toContain("[text](newStem.md)");
    expect(r.newContent).toContain("[text](oldStemExtra.md)");
  });
});

describe("computeLinkRewritePreview", () => {
  it("affected 0건 (매치 없음)", () => {
    const notes = new Map<string, string>([
      ["/v/a.md", "nothing"],
      ["/v/b.md", "neither"],
    ]);
    const p = computeLinkRewritePreview(notes, "oldStem", "newStem");
    expect(p.items).toEqual([]);
    expect(p.totalOccurrences).toBe(0);
  });

  it("affected multi-note + path 사전순 정렬 + occurrences 합", () => {
    const notes = new Map<string, string>([
      ["/v/zeta.md", "see [[oldStem]] and [[oldStem|x]]"],
      ["/v/alpha.md", "[text](oldStem.md)"],
      ["/v/beta.md", "no match here"],
    ]);
    const p = computeLinkRewritePreview(notes, "oldStem", "newStem");
    expect(p.items).toHaveLength(2);
    expect(p.items[0].path).toBe("/v/alpha.md");
    expect(p.items[1].path).toBe("/v/zeta.md");
    expect(p.items[0].occurrences).toBe(1);
    expect(p.items[1].occurrences).toBe(2);
    expect(p.totalOccurrences).toBe(3);
    expect(p.items[0].newContent).toBe("[text](newStem.md)");
    expect(p.items[1].newContent).toBe("see [[newStem]] and [[newStem|x]]");
  });

  it("oldStem === newStem (no-op)", () => {
    const notes = new Map<string, string>([["/v/a.md", "[[stem]]"]]);
    const p = computeLinkRewritePreview(notes, "stem", "stem");
    expect(p.items).toEqual([]);
    expect(p.totalOccurrences).toBe(0);
  });

  it("코드 펜스/인라인 코드 안의 매치는 카운트 X", () => {
    const notes = new Map<string, string>([
      [
        "/v/a.md",
        "real [[oldStem]]\n\n```\n[[oldStem]] in fence\n```\n\nand `[[oldStem]]` inline",
      ],
    ]);
    const p = computeLinkRewritePreview(notes, "oldStem", "newStem");
    expect(p.items).toHaveLength(1);
    expect(p.items[0].occurrences).toBe(1);
    expect(p.items[0].newContent).toContain("[[newStem]]");
    expect(p.items[0].newContent).toContain("[[oldStem]] in fence");
    expect(p.items[0].newContent).toContain("`[[oldStem]]`");
  });
});
