/**
 * `frontmatter.ts` — **사용자 파일을 다시 쓰는 유일한 frontmatter 경로**(Properties 패널)라
 * 여기서 조용히 틀리면 노트가 손상된다. 읽기 전용 앱에서 몇 안 되는 쓰기 지점이다.
 *
 * 테스트를 붙이면서 실제로 나온 결함 둘을 함께 고정한다:
 *
 * 1. **깨진 YAML을 "빈 frontmatter"로 뭉개고 덮어썼다** — 속성 하나를 고치면 원문
 *    frontmatter가 한 줄도 안 남았다. 실측: 19,213개 중 1개가 지금 그 상태다.
 * 2. **날짜가 왕복에서 변형됐다** — `date: 2026-08-20` → `2026-08-20T00:00:00.000Z`.
 *    js-yaml 기본 스키마의 `timestamp` 타입 때문이고, 이 vault는 거의 모든 노트에
 *    `created:`/`date:`가 있다.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  splitFrontmatter,
  parseFrontmatter,
  patchFrontmatter,
  addFrontmatterKey,
  isKebab,
  FrontmatterParseError,
} from "./frontmatter";

const NOTE = `---
title: 캐시 정합성 결함 3건
doc_kind: solution
topic: search
tags:
  - tech/vitest
  - issue/regression
created: 2026-08-13
---

# 본문

첫 문단.
`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("splitFrontmatter", () => {
  it("frontmatter가 없으면 원문을 본문으로 돌려준다", () => {
    const r = splitFrontmatter("# 제목\n\n본문");
    expect(r.hasFrontmatter).toBe(false);
    expect(r.frontmatter).toBe("");
    expect(r.body).toBe("# 제목\n\n본문");
  });

  it("YAML 블록과 본문을 가른다", () => {
    const r = splitFrontmatter(NOTE);
    expect(r.hasFrontmatter).toBe(true);
    expect(r.frontmatter).toContain("doc_kind: solution");
    expect(r.body).toBe("\n# 본문\n\n첫 문단.\n");
  });

  it("CRLF 줄바꿈도 받는다", () => {
    const r = splitFrontmatter("---\r\ntitle: a\r\n---\r\n본문");
    expect(r.hasFrontmatter).toBe(true);
    expect(r.frontmatter).toBe("title: a");
    expect(r.body).toBe("본문");
  });

  it("본문 안의 `---` 수평선은 건드리지 않는다 — 첫 블록만 frontmatter다", () => {
    const r = splitFrontmatter(NOTE + "\n---\n\n뒤 문단\n");
    expect(r.body).toContain("---");
    expect(r.body).toContain("뒤 문단");
    expect(r.frontmatter).not.toContain("뒤 문단");
  });

  // ⚠️ 형식 자체의 한계. `---`로 **시작하는** 문서는 그 뒤 첫 `---`까지가 frontmatter로 읽힌다.
  // 고칠 수 있는 성질이 아니라 알고 있어야 하는 성질이라 여기 박아 둔다.
  it("수평선으로 시작하는 문서는 frontmatter로 오인된다 (형식의 한계)", () => {
    const r = splitFrontmatter("---\n\n서문\n\n---\n\n본문\n");
    expect(r.hasFrontmatter).toBe(true);
  });
});

describe("parseFrontmatter", () => {
  it("매핑을 객체로 읽는다", () => {
    const { data, parseError } = parseFrontmatter(NOTE);
    expect(parseError).toBe(false);
    expect(data.title).toBe("캐시 정합성 결함 3건");
    expect(data.tags).toEqual(["tech/vitest", "issue/regression"]);
  });

  // ⚠️ 회귀 방지 1 — 기본 스키마로 읽으면 Date 객체가 돼 왕복에서 표기가 바뀐다.
  it("날짜를 **문자열 그대로** 읽는다 — Date로 만들지 않는다", () => {
    const { data } = parseFrontmatter(NOTE);
    expect(data.created).toBe("2026-08-13");
    expect(data.created).not.toBeInstanceOf(Date);
  });

  it("frontmatter가 없으면 빈 data · 실패 아님", () => {
    const r = parseFrontmatter("본문뿐");
    expect(r.data).toEqual({});
    expect(r.parseError).toBe(false);
  });

  it("내용 없는 블록은 실패가 아니다 — 잃을 게 없다", () => {
    const r = parseFrontmatter("---\n\n---\n본문");
    expect(r.data).toEqual({});
    expect(r.parseError).toBe(false);
  });

  // ⚠️ 회귀 방지 2 — 여기서 실패를 `data: {}`로 뭉개면 쓰기 경로가 원문을 날린다.
  it("깨진 YAML은 parseError로 **보고**한다 — 원문 텍스트는 살려 둔다", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = "---\ntitle: a\n  bad: indent\n---\n본문";
    const r = parseFrontmatter(broken);
    expect(r.parseError).toBe(true);
    expect(r.data).toEqual({});
    expect(r.frontmatter).toContain("bad: indent");
  });

  it("매핑이 아닌 YAML(스칼라·배열)도 parseError다", () => {
    expect(parseFrontmatter("---\n- a\n- b\n---\n본문").parseError).toBe(true);
    expect(parseFrontmatter("---\n그냥 문자열\n---\n본문").parseError).toBe(true);
  });
});

describe("patchFrontmatter", () => {
  it("기존 값을 고치고 본문은 그대로 둔다", () => {
    const out = patchFrontmatter(NOTE, { topic: "cache" });
    expect(out).toContain("topic: cache");
    expect(out).not.toContain("topic: search");
    expect(out.endsWith("\n# 본문\n\n첫 문단.\n")).toBe(true);
  });

  it("기존 키 순서를 유지한다", () => {
    const out = patchFrontmatter(NOTE, { topic: "cache" });
    const keys = [...out.matchAll(/^(\w+):/gm)].map((m) => m[1]);
    expect(keys).toEqual(["title", "doc_kind", "topic", "tags", "created"]);
  });

  it("신규 키는 스키마 우선순위 자리에 끼운다 — 끝에 붙이지 않는다", () => {
    const out = patchFrontmatter("---\ntitle: a\ncreated: 2026-08-20\n---\n본문", {
      doc_kind: "plan",
    });
    const keys = [...out.matchAll(/^(\w+):/gm)].map((m) => m[1]);
    expect(keys).toEqual(["title", "created", "doc_kind"]);
  });

  it("빈 문자열 · 빈 배열 · null은 키 삭제로 읽는다", () => {
    expect(patchFrontmatter(NOTE, { topic: "" })).not.toContain("topic:");
    expect(patchFrontmatter(NOTE, { tags: [] })).not.toContain("tags:");
    expect(patchFrontmatter(NOTE, { doc_kind: null })).not.toContain("doc_kind:");
  });

  it("키가 전부 사라지면 블록 자체를 지운다", () => {
    const one = "---\ntitle: a\n---\n본문\n";
    expect(patchFrontmatter(one, { title: "" })).toBe("본문\n");
  });

  it("frontmatter가 없던 노트엔 블록을 새로 만든다", () => {
    const out = patchFrontmatter("본문뿐\n", { title: "새 제목" });
    expect(out).toBe("---\ntitle: 새 제목\n---\n본문뿐\n");
  });

  it("배열은 block 스타일로 쓴다 — 인라인 `[a, b]`가 아니라", () => {
    const out = patchFrontmatter(NOTE, { tags: ["a", "b"] });
    expect(out).toContain("tags:\n  - a\n  - b");
  });

  // ⚠️ 회귀 방지 1 — 태그 하나만 고쳐도 날짜 표기가 바뀌던 자리.
  it("건드리지 않은 날짜는 표기 그대로 남는다", () => {
    const out = patchFrontmatter(NOTE, { topic: "cache" });
    expect(out).toContain("created: 2026-08-13");
    expect(out).not.toContain("2026-08-13T00:00:00.000Z");
  });

  it("frontmatter와 본문 사이 빈 줄을 지키다", () => {
    const out = patchFrontmatter(NOTE, { topic: "cache" });
    expect(out).toContain("---\n\n# 본문");
  });

  it("여러 번 왕복해도 원문이 그대로다 — 손실 누적 없음", () => {
    const once = patchFrontmatter(NOTE, { topic: "search" });
    const twice = patchFrontmatter(once, { topic: "search" });
    expect(twice).toBe(once);
  });

  // ⚠️ 회귀 방지 2 — 조용히 성공하면 원문 frontmatter가 통째로 날아간다.
  it("YAML을 못 읽는 노트는 **던진다** — 덮어쓰지 않는다", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = "---\ntitle: a\n  bad: indent\n---\n본문";
    expect(() => patchFrontmatter(broken, { topic: "x" })).toThrow(FrontmatterParseError);
  });
});

describe("addFrontmatterKey", () => {
  it("빈 값도 보존한다 — patch와 계약이 다르다(사용자가 명시적으로 추가한 키다)", () => {
    const out = addFrontmatterKey("---\ntitle: a\n---\n본문", "tags", []);
    expect(out).toContain("tags: []");
    expect(patchFrontmatter("---\ntitle: a\n---\n본문", { tags: [] })).not.toContain("tags");
  });

  it("이미 있는 키면 원문을 그대로 돌려준다", () => {
    expect(addFrontmatterKey(NOTE, "topic", "무시됨")).toBe(NOTE);
  });

  it("YAML을 못 읽는 노트는 던진다", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => addFrontmatterKey("---\na: 1\n b: 2\n---\n본문", "tags", [])).toThrow(
      FrontmatterParseError,
    );
  });
});

describe("isKebab", () => {
  it.each(["a", "tech", "tech-stack", "tech/svelte5", "issue/atomic-write", "a/b/c"])(
    "통과: %s",
    (s) => expect(isKebab(s)).toBe(true),
  );

  it.each(["", "A", "Tech", "tech_stack", "tech--stack", "tech-", "-tech", "tech//a", "tech/", "한글", "a b"])(
    "거부: %s",
    (s) => expect(isKebab(s)).toBe(false),
  );
});
