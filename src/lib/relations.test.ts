import { describe, it, expect } from "vitest";
import {
  normalizeRef,
  buildRelationIndex,
  groupRelations,
  type Relation,
} from "./relations";
import type { LinkInfo } from "./tauri/notes";

function mkInfo(partial: Partial<LinkInfo> & { source_path: string }): LinkInfo {
  const stem = partial.source_path.split("/").pop()!.replace(/\.md$/, "");
  return {
    source_name: stem,
    title: null,
    aliases: [],
    targets: [],
    tags: [],
    doc_kind: null,
    topic: null,
    related: [],
    props: {},
    ...partial,
  };
}

describe("normalizeRef — 실측 frontmatter 형태 흡수", () => {
  it("경로를 마지막 세그먼트 stem으로 환원", () => {
    expect(normalizeRef("plans/perf-cache.md")).toEqual(["perf-cache"]);
  });

  it(".md / .mmd 확장자 제거", () => {
    expect(normalizeRef("foo.md")).toEqual(["foo"]);
    expect(normalizeRef("diagram.mmd")).toEqual(["diagram"]);
  });

  it("꼬리 괄호 주석 제거", () => {
    expect(normalizeRef("brainstorms/mcp-x.md (deferred)")).toEqual(["mcp-x"]);
  });

  it("인라인 콤마 멀티 분리", () => {
    expect(normalizeRef("a.md, plans/b.md")).toEqual(["a", "b"]);
  });

  it("wikilink와 alias 벗기기", () => {
    expect(normalizeRef("[[foo]]")).toEqual(["foo"]);
    expect(normalizeRef("[[foo|별칭]]")).toEqual(["foo"]);
  });

  it("감싼 따옴표 제거 + bare stem 보존", () => {
    expect(normalizeRef("'project_feature_map'")).toEqual(["project_feature_map"]);
    expect(normalizeRef("plain-stem")).toEqual(["plain-stem"]);
  });

  it("빈/공백 입력 → 빈 배열", () => {
    expect(normalizeRef("")).toEqual([]);
    expect(normalizeRef("  ,  ")).toEqual([]);
  });
});

describe("buildRelationIndex", () => {
  const plan = mkInfo({ source_path: "/v/plans/phase-4.3.md" });
  const sub = mkInfo({
    source_path: "/v/plans/phase-4.3a.md",
    props: { parent_plan: ["phase-4.3.md"] },
  });
  // `resolver`는 이름 → **후보 목록**이다(같은 이름의 노트가 둘 이상일 수 있다).
  const resolver = {
    resolver: new Map<string, string[]>([
      ["phase-4.3", ["/v/plans/phase-4.3.md"]],
      ["phase-4.3a", ["/v/plans/phase-4.3a.md"]],
    ]),
  };

  it("관계 타입(필드명) 보존 + 양방향 인덱싱", () => {
    const idx = buildRelationIndex([plan, sub], resolver);
    expect(idx.outgoing.get("/v/plans/phase-4.3a.md")).toEqual([
      { type: "parent_plan", path: "/v/plans/phase-4.3.md" },
    ]);
    expect(idx.incoming.get("/v/plans/phase-4.3.md")).toEqual([
      { type: "parent_plan", path: "/v/plans/phase-4.3a.md" },
    ]);
  });

  it("경로형 값 resolve (현재 stem-only resolver의 빈틈 메움)", () => {
    const a = mkInfo({ source_path: "/v/a.md", props: { related: ["sub/b.md"] } });
    const b = mkInfo({ source_path: "/v/sub/b.md" });
    const r = { resolver: new Map([["b", ["/v/sub/b.md"]]]) };
    const idx = buildRelationIndex([a, b], r);
    expect(idx.outgoing.get("/v/a.md")).toEqual([{ type: "related", path: "/v/sub/b.md" }]);
  });

  it("NON_RELATION_FIELDS(title/status 등)는 resolve돼도 관계 아님", () => {
    // title 값이 우연히 다른 노트 stem과 일치해도 거짓 관계 만들지 않음
    const note = mkInfo({ source_path: "/v/x.md", props: { title: ["phase-4.3"], status: ["done"] } });
    const idx = buildRelationIndex([note, plan], resolver);
    expect(idx.outgoing.get("/v/x.md")).toBeUndefined();
  });

  it("self-link 제외", () => {
    const selfish = mkInfo({ source_path: "/v/self.md", props: { related: ["self.md"] } });
    const r = { resolver: new Map([["self", ["/v/self.md"]]]) };
    const idx = buildRelationIndex([selfish], r);
    expect(idx.outgoing.get("/v/self.md")).toBeUndefined();
  });

  it("resolve 안 되는 값(#PR번호 등)은 자동 드롭", () => {
    const note = mkInfo({ source_path: "/v/x.md", props: { related_pr: ["#88", "#90"] } });
    const idx = buildRelationIndex([note], { resolver: new Map() });
    expect(idx.outgoing.get("/v/x.md")).toBeUndefined();
  });

  it("같은 (타입, target) 중복 제거", () => {
    const note = mkInfo({
      source_path: "/v/x.md",
      props: { related: ["target.md", "sub/target.md"] },
    });
    const r = { resolver: new Map([["target", ["/v/target.md"]]]) };
    const idx = buildRelationIndex([note, mkInfo({ source_path: "/v/target.md" })], r);
    expect(idx.outgoing.get("/v/x.md")).toEqual([{ type: "related", path: "/v/target.md" }]);
  });
});

describe("groupRelations", () => {
  const byPath = new Map<string, LinkInfo>([
    ["/v/a.md", mkInfo({ source_path: "/v/a.md", title: "Alpha" })],
    ["/v/b.md", mkInfo({ source_path: "/v/b.md", title: "Beta" })],
    ["/v/c.md", mkInfo({ source_path: "/v/c.md" })], // title 없음 → source_name "c"
  ]);

  it("타입별 묶기 + 타입 알파벳 정렬 + 노트 이름 정렬", () => {
    const rels: Relation[] = [
      { type: "parent_plan", path: "/v/b.md" },
      { type: "depends_on", path: "/v/c.md" },
      { type: "depends_on", path: "/v/a.md" },
    ];
    const groups = groupRelations(rels, byPath);
    expect(groups.map((g) => g.type)).toEqual(["depends_on", "parent_plan"]);
    expect(groups[0].notes.map((n) => n.title ?? n.source_name)).toEqual(["Alpha", "c"]);
    expect(groups[1].notes.map((n) => n.title)).toEqual(["Beta"]);
  });

  it("byPath에 없는 path는 스킵", () => {
    const groups = groupRelations([{ type: "related", path: "/v/missing.md" }], byPath);
    expect(groups).toEqual([]);
  });
});
