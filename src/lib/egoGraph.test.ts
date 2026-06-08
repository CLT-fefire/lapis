import { describe, it, expect } from "vitest";
import { buildIndex } from "./linkIndex";
import { buildEgoGraph, type EgoNode } from "./egoGraph";
import type { LinkInfo } from "./tauri/notes";

function mkInfo(
  path: string,
  opts: { targets?: string[]; props?: Record<string, string[]>; title?: string | null } = {},
): LinkInfo {
  const stem = path.split("/").pop()!.replace(/\.md$/, "");
  return {
    source_path: path,
    source_name: stem,
    title: opts.title ?? null,
    aliases: [],
    targets: opts.targets ?? [],
    tags: [],
    doc_kind: null,
    topic: null,
    related: [],
    props: opts.props ?? {},
  };
}

function byId(nodes: EgoNode[], id: string): EgoNode | undefined {
  return nodes.find((n) => n.id === id);
}

describe("buildEgoGraph — depth 1 (양방향 이웃)", () => {
  // A→B(본문), C→A(backlink), A-rel->D, E 무관
  const idx = buildIndex([
    mkInfo("/r/a.md", { targets: ["b"], props: { depends_on: ["d"] } }),
    mkInfo("/r/b.md"),
    mkInfo("/r/c.md", { targets: ["a"] }),
    mkInfo("/r/d.md"),
    mkInfo("/r/e.md"),
  ]);

  it("중심 + 직접 이웃(본문 out/in + 관계)", () => {
    const g = buildEgoGraph(idx, "/r/a.md", { depth: 1 });
    expect(g.nodes.map((n) => n.id).sort()).toEqual([
      "/r/a.md",
      "/r/b.md",
      "/r/c.md",
      "/r/d.md",
    ]);
    expect(byId(g.nodes, "/r/a.md")!.depth).toBe(0);
    expect(byId(g.nodes, "/r/b.md")!.depth).toBe(1);
    expect(g.center).toBe("/r/a.md");
  });

  it("무관 노트(E)는 미포함", () => {
    const g = buildEgoGraph(idx, "/r/a.md", { depth: 1 });
    expect(byId(g.nodes, "/r/e.md")).toBeUndefined();
  });

  it("로컬 degree = in+out", () => {
    const g = buildEgoGraph(idx, "/r/a.md", { depth: 1 });
    // A: out(B,D) + in(C) = 3
    expect(byId(g.nodes, "/r/a.md")!.degree).toBe(3);
    expect(byId(g.nodes, "/r/b.md")!.degree).toBe(1);
  });

  it("엣지는 가중·방향 (관계+본문)", () => {
    const g = buildEgoGraph(idx, "/r/a.md", { depth: 1 });
    const find = (s: string, t: string) => g.edges.find((e) => e.source === s && e.target === t);
    expect(find("/r/a.md", "/r/b.md")?.weight).toBe(1);
    expect(find("/r/a.md", "/r/d.md")?.weight).toBe(1);
    expect(find("/r/c.md", "/r/a.md")?.weight).toBe(1);
  });
});

describe("depth 2 — 2 hop 전파", () => {
  // A→B→C→D (체인)
  const idx = buildIndex([
    mkInfo("/r/a.md", { targets: ["b"] }),
    mkInfo("/r/b.md", { targets: ["c"] }),
    mkInfo("/r/c.md", { targets: ["d"] }),
    mkInfo("/r/d.md"),
  ]);

  it("depth 1 = A,B / depth 2 = A,B,C", () => {
    const g1 = buildEgoGraph(idx, "/r/a.md", { depth: 1 });
    expect(g1.nodes.map((n) => n.id).sort()).toEqual(["/r/a.md", "/r/b.md"]);
    const g2 = buildEgoGraph(idx, "/r/a.md", { depth: 2 });
    expect(g2.nodes.map((n) => n.id).sort()).toEqual(["/r/a.md", "/r/b.md", "/r/c.md"]);
    expect(byId(g2.nodes, "/r/c.md")!.depth).toBe(2);
  });
});

describe("topN cap + hiddenNeighbors", () => {
  // hub → n0..n19 (20 본문링크)
  const infos = [mkInfo("/r/hub.md", { targets: Array.from({ length: 20 }, (_, i) => `n${i}`) })];
  for (let i = 0; i < 20; i++) infos.push(mkInfo(`/r/n${i}.md`));
  const idx = buildIndex(infos);

  it("topN=5 → 중심 + 5 이웃, hub.hiddenNeighbors=15", () => {
    const g = buildEgoGraph(idx, "/r/hub.md", { depth: 1, topN: 5 });
    expect(g.nodes).toHaveLength(6); // hub + 5
    expect(byId(g.nodes, "/r/hub.md")!.hiddenNeighbors).toBe(15);
  });

  it("expanded={hub} → 전체 20 이웃, hiddenNeighbors=0", () => {
    const g = buildEgoGraph(idx, "/r/hub.md", {
      depth: 1,
      topN: 5,
      expanded: new Set(["/r/hub.md"]),
    });
    expect(g.nodes).toHaveLength(21); // hub + 20
    expect(byId(g.nodes, "/r/hub.md")!.hiddenNeighbors).toBe(0);
  });
});

describe("maxNodes 가드", () => {
  it("초과 시 truncated + 노드 캡", () => {
    const infos = [mkInfo("/r/hub.md", { targets: Array.from({ length: 50 }, (_, i) => `n${i}`) })];
    for (let i = 0; i < 50; i++) infos.push(mkInfo(`/r/n${i}.md`));
    const idx = buildIndex(infos);
    const g = buildEgoGraph(idx, "/r/hub.md", { depth: 1, topN: 50, maxNodes: 10 });
    expect(g.truncated).toBe(true);
    expect(g.nodes.length).toBeLessThanOrEqual(10);
  });
});

describe("_memories 제외", () => {
  // A→mem(_memories), A→B
  const idx = buildIndex([
    mkInfo("/r/a.md", { targets: ["mem", "b"] }),
    mkInfo("/r/b.md"),
    mkInfo("/r/_memories/mem.md"),
  ]);

  it("제외 폴더 이웃은 노드·hiddenNeighbors 양쪽에서 배제", () => {
    const g = buildEgoGraph(idx, "/r/a.md", { depth: 1 });
    expect(byId(g.nodes, "/r/_memories/mem.md")).toBeUndefined();
    expect(byId(g.nodes, "/r/b.md")).toBeDefined();
    // mem은 완전 배제 → A의 hiddenNeighbors에도 안 셈
    expect(byId(g.nodes, "/r/a.md")!.hiddenNeighbors).toBe(0);
  });

  it("중심이 _memories여도 자신은 표시", () => {
    const g = buildEgoGraph(idx, "/r/_memories/mem.md", { depth: 1 });
    expect(byId(g.nodes, "/r/_memories/mem.md")).toBeDefined();
  });
});

describe("folder 색 기준 (vaultRoot)", () => {
  it("vaultRoot 주면 최상위 폴더", () => {
    const idx = buildIndex([
      mkInfo("/root/lapis/a.md", { targets: ["b"] }),
      mkInfo("/root/lapis/b.md"),
    ]);
    const g = buildEgoGraph(idx, "/root/lapis/a.md", { depth: 1, vaultRoot: "/root" });
    expect(byId(g.nodes, "/root/lapis/a.md")!.folder).toBe("lapis");
  });
});

describe("멱등 / 엣지 케이스", () => {
  const infos = [
    mkInfo("/r/a.md", { targets: ["b", "c"] }),
    mkInfo("/r/b.md", { targets: ["c"] }),
    mkInfo("/r/c.md"),
  ];

  it("같은 입력·expanded → 같은 결과(결정론)", () => {
    const expanded = new Set(["/r/a.md"]);
    const g1 = buildEgoGraph(buildIndex(infos), "/r/a.md", { depth: 2, expanded });
    const g2 = buildEgoGraph(buildIndex(infos), "/r/a.md", { depth: 2, expanded });
    expect(g1.nodes.map((n) => n.id).sort()).toEqual(g2.nodes.map((n) => n.id).sort());
    expect(g1.edges.length).toBe(g2.edges.length);
  });

  it("이웃 없는 중심 → 단독 노드", () => {
    const idx = buildIndex([mkInfo("/r/lonely.md"), mkInfo("/r/other.md")]);
    const g = buildEgoGraph(idx, "/r/lonely.md", { depth: 2 });
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0].id).toBe("/r/lonely.md");
    expect(g.nodes[0].degree).toBe(0);
    expect(g.edges).toHaveLength(0);
  });

  it("인덱스에 없는 중심 → 단독(label=path)", () => {
    const idx = buildIndex([mkInfo("/r/a.md")]);
    const g = buildEgoGraph(idx, "/r/ghost.md", { depth: 1 });
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0].id).toBe("/r/ghost.md");
  });
});
