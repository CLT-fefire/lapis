import { describe, it, expect } from "vitest";
import {
  renameTag,
  isTagAffected,
  rewriteTagsInFrontmatter,
  rewriteTagsInNote,
  computeTagRewritePreview,
} from "./tagRewrite";

describe("renameTag — 계층은 접두로 따라 움직인다", () => {
  it("정확히 일치하면 바꾼다", () => {
    expect(renameTag("tech", "tech", "stack")).toBe("stack");
  });

  it("자식도 따라 움직인다", () => {
    expect(renameTag("tech/svelte5", "tech", "stack")).toBe("stack/svelte5");
    expect(renameTag("tech/a/b", "tech", "stack")).toBe("stack/a/b");
  });

  it("경계는 `/`에서만 — technical을 먹지 않는다", () => {
    expect(renameTag("technical", "tech", "stack")).toBe("technical");
    expect(renameTag("tech-debt", "tech", "stack")).toBe("tech-debt");
  });

  it("무관한 태그는 그대로", () => {
    expect(renameTag("issue/bug", "tech", "stack")).toBe("issue/bug");
  });

  it("깊은 태그의 이름 바꾸기", () => {
    expect(renameTag("tech/svelte5", "tech/svelte5", "tech/svelte")).toBe("tech/svelte");
    expect(renameTag("tech/svelte5/runes", "tech/svelte5", "tech/svelte")).toBe(
      "tech/svelte/runes",
    );
  });

  it("isTagAffected가 같은 경계를 쓴다", () => {
    expect(isTagAffected("tech", "tech")).toBe(true);
    expect(isTagAffected("tech/a", "tech")).toBe(true);
    expect(isTagAffected("technical", "tech")).toBe(false);
  });
});

describe("rewriteTagsInFrontmatter — 인라인", () => {
  it("배열 형식", () => {
    const r = rewriteTagsInFrontmatter("tags: [tech/svelte5, issue/bug]", "tech/svelte5", "tech/svelte");
    expect(r.text).toBe("tags: [tech/svelte, issue/bug]");
    expect(r.count).toBe(1);
  });

  it("따옴표 스타일을 보존한다", () => {
    const r = rewriteTagsInFrontmatter('tags: ["tech/svelte5", issue/bug]', "tech/svelte5", "tech/svelte");
    expect(r.text).toBe('tags: ["tech/svelte", issue/bug]');
  });

  it("병합 시 중복을 제거한다", () => {
    const r = rewriteTagsInFrontmatter("tags: [a, b]", "a", "b");
    expect(r.text).toBe("tags: [b]");
    expect(r.count).toBe(1);
  });
});

describe("rewriteTagsInFrontmatter — 블록", () => {
  const yaml = ["title: 노트", "tags:", "  - tech/svelte5", "  - issue/bug", "topic: build"].join("\n");

  it("항목을 바꾼다", () => {
    const r = rewriteTagsInFrontmatter(yaml, "tech/svelte5", "tech/svelte");
    expect(r.text.split("\n")[2]).toBe("  - tech/svelte");
    expect(r.count).toBe(1);
  });

  it("tags 블록 밖은 건드리지 않는다", () => {
    const r = rewriteTagsInFrontmatter(yaml, "build", "ci");
    expect(r.count).toBe(0);
    expect(r.text).toBe(yaml); // topic: build 는 태그가 아니다
  });

  it("병합 시 중복 줄을 버린다", () => {
    const y = ["tags:", "  - a", "  - b"].join("\n");
    const r = rewriteTagsInFrontmatter(y, "a", "b");
    expect(r.text).toBe(["tags:", "  - b"].join("\n"));
  });

  it("들여쓰기가 풀리면 블록이 끝난다", () => {
    const y = ["tags:", "  - a", "other: a"].join("\n");
    const r = rewriteTagsInFrontmatter(y, "a", "z");
    expect(r.text).toBe(["tags:", "  - z", "other: a"].join("\n"));
    expect(r.count).toBe(1);
  });
});

describe("rewriteTagsInNote", () => {
  const note = ["---", "tags:", "  - tech/svelte5", "---", "", "본문에 #tech/svelte5 라고 써도 무시된다."].join("\n");

  it("frontmatter만 바꾸고 본문은 그대로 둔다", () => {
    const r = rewriteTagsInNote(note, "tech/svelte5", "tech/svelte");
    expect(r.changed).toBe(true);
    expect(r.newContent).toContain("  - tech/svelte\n");
    // 본문 `#tag`는 인덱싱 대상이 아니라는 판단을 뒤집지 않는다.
    expect(r.newContent).toContain("본문에 #tech/svelte5 라고");
  });

  it("frontmatter가 없으면 아무것도 안 한다", () => {
    const r = rewriteTagsInNote("# 제목만 있는 노트", "a", "b");
    expect(r.changed).toBe(false);
  });

  it("대상 태그가 없으면 changed=false", () => {
    const r = rewriteTagsInNote(note, "없는태그", "새태그");
    expect(r.changed).toBe(false);
    expect(r.newContent).toBe(note);
  });

  it("같은 이름으로 바꾸면 아무것도 안 한다", () => {
    expect(rewriteTagsInNote(note, "tech", "tech").changed).toBe(false);
  });
});

describe("computeTagRewritePreview", () => {
  const notes = new Map([
    ["/v/a.md", ["---", "tags: [tech/svelte5]", "---", "A"].join("\n")],
    ["/v/b.md", ["---", "tags: [tech/svelte5, issue/bug]", "---", "B"].join("\n")],
    ["/v/c.md", ["---", "tags: [issue/bug]", "---", "C"].join("\n")],
  ]);

  it("영향받는 노트만 낸다", () => {
    const p = computeTagRewritePreview(notes, "tech/svelte5", "tech/svelte");
    expect(p.items.map((i) => i.path)).toEqual(["/v/a.md", "/v/b.md"]);
    expect(p.totalOccurrences).toBe(2);
  });

  it("newContent를 함께 담는다 — 적용 시 다시 읽지 않는다", () => {
    const p = computeTagRewritePreview(notes, "tech/svelte5", "tech/svelte");
    expect(p.items[0].newContent).toContain("tags: [tech/svelte]");
  });

  it("병합 여부를 알려준다", () => {
    const merge = computeTagRewritePreview(notes, "tech/svelte5", "issue/bug", ["issue/bug"]);
    expect(merge.merge).toBe(true);
    const fresh = computeTagRewritePreview(notes, "tech/svelte5", "완전히새것", ["issue/bug"]);
    expect(fresh.merge).toBe(false);
  });

  it("빈 입력은 아무것도 안 한다", () => {
    expect(computeTagRewritePreview(notes, "", "x").items).toEqual([]);
    expect(computeTagRewritePreview(notes, "x", "").items).toEqual([]);
  });
});
