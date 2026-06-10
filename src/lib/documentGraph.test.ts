import { describe, it, expect } from "vitest";
import { buildIndex } from "./linkIndex";
import {
  buildDocumentGraph,
  filterDocGraph,
  computeBetweenness,
  disparityBackbone,
  edgeKey,
  projectOf,
  mulberry32,
  DEFAULT_EXCLUDED_FOLDERS,
  type DocGraphNode,
} from "./documentGraph";
import type { LinkInfo } from "./tauri/notes";

function mkInfo(
  path: string,
  opts: {
    targets?: string[];
    props?: Record<string, string[]>;
    title?: string | null;
    docKind?: string;
  } = {},
): LinkInfo {
  const stem = path.split("/").pop()!.replace(/\.md$/, "");
  return {
    source_path: path,
    source_name: stem,
    title: opts.title ?? null,
    aliases: [],
    targets: opts.targets ?? [],
    tags: [],
    doc_kind: opts.docKind ?? null,
    topic: null,
    related: [],
    props: opts.props ?? {},
  };
}

function nodeById(nodes: DocGraphNode[], id: string): DocGraphNode | undefined {
  return nodes.find((n) => n.id === id);
}

describe("projectOf", () => {
  it("최상위 폴더 추출", () => {
    expect(projectOf("/root/lapis/plans/foo.md", "/root")).toBe("lapis");
  });
  it("루트 직속 노트는 null", () => {
    expect(projectOf("/root/foo.md", "/root")).toBeNull();
  });
  it("vault 밖 / vaultRoot 미지정은 null", () => {
    expect(projectOf("/other/x.md", "/root")).toBeNull();
    expect(projectOf("/root/lapis/foo.md", "")).toBeNull();
  });
});

describe("mulberry32 결정론", () => {
  it("같은 seed → 같은 수열", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });
  it("다른 seed → 다른 수열", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });
  it("[0,1) 범위", () => {
    const r = mulberry32(999);
    for (let i = 0; i < 50; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("buildDocumentGraph — 노드/엣지 기본", () => {
  // A -parent_plan-> B, A -본문링크-> C, B -본문링크-> C
  const idx = buildIndex([
    mkInfo("/root/lapis/a.md", { props: { parent_plan: ["b"] }, targets: ["c"] }),
    mkInfo("/root/lapis/b.md", { targets: ["c"] }),
    mkInfo("/root/lapis/c.md"),
  ]);

  it("모든 노트가 노드 (고립 제거 없음 — G3′ 필터 책임)", () => {
    const g = buildDocumentGraph(idx);
    expect(g.nodes.map((n) => n.id).sort()).toEqual([
      "/root/lapis/a.md",
      "/root/lapis/b.md",
      "/root/lapis/c.md",
    ]);
  });

  it("엣지는 방향 보존 + weight", () => {
    const g = buildDocumentGraph(idx);
    const find = (s: string, t: string) =>
      g.edges.find((e) => e.source === s && e.target === t);
    expect(find("/root/lapis/a.md", "/root/lapis/b.md")?.weight).toBe(1);
    expect(find("/root/lapis/a.md", "/root/lapis/c.md")?.weight).toBe(1);
    expect(find("/root/lapis/b.md", "/root/lapis/c.md")?.weight).toBe(1);
    // 반대 방향은 없음
    expect(find("/root/lapis/b.md", "/root/lapis/a.md")).toBeUndefined();
  });

  it("degree = in+out", () => {
    const g = buildDocumentGraph(idx);
    // C는 A·B에서 들어오는 2개(in), out 0 → degree 2
    expect(nodeById(g.nodes, "/root/lapis/c.md")?.degree).toBe(2);
    // A는 out 2(B,C), in 0 → degree 2
    expect(nodeById(g.nodes, "/root/lapis/a.md")?.degree).toBe(2);
    // B는 out 1(C), in 1(A) → degree 2
    expect(nodeById(g.nodes, "/root/lapis/b.md")?.degree).toBe(2);
  });

  it("label = title ?? source_name", () => {
    const idx2 = buildIndex([mkInfo("/r/x.md", { title: "엑스 문서" }), mkInfo("/r/y.md")]);
    const g = buildDocumentGraph(idx2);
    expect(nodeById(g.nodes, "/r/x.md")?.label).toBe("엑스 문서");
    expect(nodeById(g.nodes, "/r/y.md")?.label).toBe("y");
  });
});

describe("weight 집계 — 관계 + 본문링크 같은 pair", () => {
  it("A가 B를 관계+본문 둘 다 가리키면 weight 2 (1 엣지로 집계)", () => {
    const idx = buildIndex([
      mkInfo("/r/a.md", { props: { depends_on: ["b"] }, targets: ["b"] }),
      mkInfo("/r/b.md"),
    ]);
    const g = buildDocumentGraph(idx);
    const ab = g.edges.filter((e) => e.source === "/r/a.md" && e.target === "/r/b.md");
    expect(ab).toHaveLength(1);
    expect(ab[0].weight).toBe(2);
  });
});

describe("노이즈 폴더 제외 (_memories)", () => {
  const idx = buildIndex([
    mkInfo("/root/lapis/a.md", { targets: ["mem", "b"] }),
    mkInfo("/root/lapis/b.md"),
    mkInfo("/root/lapis/_memories/mem.md"),
  ]);

  it("기본으로 _memories 노드 제외 + excludedCount", () => {
    const g = buildDocumentGraph(idx);
    expect(g.excludedCount).toBe(1);
    expect(nodeById(g.nodes, "/root/lapis/_memories/mem.md")).toBeUndefined();
  });

  it("제외 노드로 향하는 엣지도 빠짐", () => {
    const g = buildDocumentGraph(idx);
    expect(g.edges.some((e) => e.target.includes("_memories"))).toBe(false);
    // A→B 본문링크는 남음
    expect(g.edges.some((e) => e.source === "/root/lapis/a.md" && e.target === "/root/lapis/b.md")).toBe(true);
  });

  it("excludeFolders 빈 배열이면 제외 안 함", () => {
    const g = buildDocumentGraph(idx, { excludeFolders: [] });
    expect(g.excludedCount).toBe(0);
    expect(nodeById(g.nodes, "/root/lapis/_memories/mem.md")).toBeDefined();
  });

  it("기본 제외 목록은 _memories", () => {
    expect(DEFAULT_EXCLUDED_FOLDERS).toContain("_memories");
  });
});

describe("folder 추출 (vaultRoot)", () => {
  it("vaultRoot 주면 최상위 폴더, 안 주면 null", () => {
    const idx = buildIndex([mkInfo("/root/lapis/plans/a.md"), mkInfo("/root/other/b.md")]);
    const withRoot = buildDocumentGraph(idx, { vaultRoot: "/root" });
    expect(nodeById(withRoot.nodes, "/root/lapis/plans/a.md")?.folder).toBe("lapis");
    expect(nodeById(withRoot.nodes, "/root/other/b.md")?.folder).toBe("other");

    const noRoot = buildDocumentGraph(idx);
    expect(nodeById(noRoot.nodes, "/root/lapis/plans/a.md")?.folder).toBeNull();
  });
});

describe("community — 분리된 두 클러스터", () => {
  // 클러스터1: a↔b↔c (삼각형), 클러스터2: x↔y↔z (삼각형), 둘 사이 연결 없음
  const idx = buildIndex([
    mkInfo("/r/a.md", { targets: ["b", "c"] }),
    mkInfo("/r/b.md", { targets: ["c", "a"] }),
    mkInfo("/r/c.md", { targets: ["a", "b"] }),
    mkInfo("/r/x.md", { targets: ["y", "z"] }),
    mkInfo("/r/y.md", { targets: ["z", "x"] }),
    mkInfo("/r/z.md", { targets: ["x", "y"] }),
  ]);

  it("분리된 컴포넌트는 반드시 다른 community (연결요소 split 보장)", () => {
    const g = buildDocumentGraph(idx);
    const c1 = nodeById(g.nodes, "/r/a.md")!.community;
    const cb = nodeById(g.nodes, "/r/b.md")!.community;
    const cc = nodeById(g.nodes, "/r/c.md")!.community;
    const c2 = nodeById(g.nodes, "/r/x.md")!.community;
    // 클러스터1 내부는 같은 community
    expect(cb).toBe(c1);
    expect(cc).toBe(c1);
    // 두 클러스터는 다른 community
    expect(c2).not.toBe(c1);
    expect(g.communityCount).toBeGreaterThanOrEqual(2);
  });

  it("community 번호는 0..count-1 연속", () => {
    const g = buildDocumentGraph(idx);
    const comms = new Set(g.nodes.map((n) => n.community));
    expect(comms.size).toBe(g.communityCount);
    for (let i = 0; i < g.communityCount; i++) expect(comms.has(i)).toBe(true);
  });

  it("큰 community가 작은 것보다 낮은 번호 (크기 내림차순 재번호)", () => {
    // 클러스터1(3노드) + 고립노드 1개 → 0=3노드, 1=고립
    const idx2 = buildIndex([
      mkInfo("/r/a.md", { targets: ["b", "c"] }),
      mkInfo("/r/b.md", { targets: ["c", "a"] }),
      mkInfo("/r/c.md", { targets: ["a", "b"] }),
      mkInfo("/r/lonely.md"),
    ]);
    const g = buildDocumentGraph(idx2);
    expect(nodeById(g.nodes, "/r/a.md")!.community).toBe(0);
    expect(nodeById(g.nodes, "/r/lonely.md")!.community).toBe(1);
  });
});

describe("결정론 — seed 고정", () => {
  const infos = [
    mkInfo("/r/a.md", { targets: ["b", "c"] }),
    mkInfo("/r/b.md", { targets: ["c", "a"] }),
    mkInfo("/r/c.md", { targets: ["a", "b"] }),
    mkInfo("/r/x.md", { targets: ["y", "z"] }),
    mkInfo("/r/y.md", { targets: ["z", "x"] }),
    mkInfo("/r/z.md", { targets: ["x", "y"] }),
  ];

  it("같은 입력·seed → 같은 community 매핑", () => {
    const g1 = buildDocumentGraph(buildIndex(infos));
    const g2 = buildDocumentGraph(buildIndex(infos));
    const map1 = Object.fromEntries(g1.nodes.map((n) => [n.id, n.community]));
    const map2 = Object.fromEntries(g2.nodes.map((n) => [n.id, n.community]));
    expect(map1).toEqual(map2);
  });
});

describe("PageRank", () => {
  it("여러 노트가 가리키는 허브가 더 높은 PageRank", () => {
    // hub ← a, b, c (모두 hub를 본문링크)
    const idx = buildIndex([
      mkInfo("/r/hub.md"),
      mkInfo("/r/a.md", { targets: ["hub"] }),
      mkInfo("/r/b.md", { targets: ["hub"] }),
      mkInfo("/r/c.md", { targets: ["hub"] }),
    ]);
    const g = buildDocumentGraph(idx);
    const hub = nodeById(g.nodes, "/r/hub.md")!.pagerank;
    const a = nodeById(g.nodes, "/r/a.md")!.pagerank;
    expect(hub).toBeGreaterThan(a);
  });
});

describe("엣지 케이스 가드", () => {
  it("빈 인덱스 → 빈 그래프", () => {
    const g = buildDocumentGraph(buildIndex([]));
    expect(g.nodes).toHaveLength(0);
    expect(g.edges).toHaveLength(0);
    expect(g.communityCount).toBe(0);
  });

  it("엣지 없는 노드들 → 각자 단독 community, pagerank 0", () => {
    const idx = buildIndex([mkInfo("/r/a.md"), mkInfo("/r/b.md")]);
    const g = buildDocumentGraph(idx);
    expect(g.edges).toHaveLength(0);
    expect(g.communityCount).toBe(2);
    expect(nodeById(g.nodes, "/r/a.md")!.community).not.toBe(
      nodeById(g.nodes, "/r/b.md")!.community,
    );
    expect(nodeById(g.nodes, "/r/a.md")!.pagerank).toBe(0);
  });

  it("graph 인스턴스 노출 + 노드 attribute에 메트릭 기록", () => {
    const idx = buildIndex([mkInfo("/r/a.md", { targets: ["b"] }), mkInfo("/r/b.md")]);
    const g = buildDocumentGraph(idx);
    expect(g.graph.order).toBe(2);
    expect(g.graph.size).toBe(1);
    expect(g.graph.getNodeAttribute("/r/a.md", "degree")).toBe(1);
    expect(g.graph.getNodeAttribute("/r/b.md", "degree")).toBe(1);
  });
});

describe("노드 type (doc_kind ?? props.type)", () => {
  it("doc_kind 우선 → props.type fallback → null", () => {
    const g = buildDocumentGraph(
      buildIndex([
        mkInfo("/r/a.md", { docKind: "plan", props: { type: ["solution"] } }),
        mkInfo("/r/b.md", { props: { type: ["solution"] } }),
        mkInfo("/r/c.md"),
      ]),
    );
    expect(nodeById(g.nodes, "/r/a.md")!.type).toBe("plan");
    expect(nodeById(g.nodes, "/r/b.md")!.type).toBe("solution");
    expect(nodeById(g.nodes, "/r/c.md")!.type).toBeNull();
  });
});

describe("scopeFolders — 프로젝트 스코프", () => {
  const infos = [
    mkInfo("/root/lapis/a.md", { targets: ["b"] }),
    mkInfo("/root/lapis/b.md"),
    mkInfo("/root/other/c.md", { targets: ["a"] }),
  ];

  it("scope=lapis면 lapis 노트만 + 타 프로젝트 엣지 제외", () => {
    const g = buildDocumentGraph(buildIndex(infos), {
      vaultRoot: "/root",
      scopeFolders: ["lapis"],
    });
    expect(g.nodes.map((n) => n.id).sort()).toEqual([
      "/root/lapis/a.md",
      "/root/lapis/b.md",
    ]);
    expect(g.edges.some((e) => e.source.includes("other") || e.target.includes("other"))).toBe(
      false,
    );
  });

  it("scope 미지정이면 전체", () => {
    const g = buildDocumentGraph(buildIndex(infos), { vaultRoot: "/root" });
    expect(g.nodes.length).toBe(3);
  });
});

describe("filterDocGraph", () => {
  // hub→a,b,c (hub degree 3), a→b, orphan 고립
  const base = buildDocumentGraph(
    buildIndex([
      mkInfo("/r/hub.md", { targets: ["a", "b", "c"] }),
      mkInfo("/r/a.md", { targets: ["b"] }),
      mkInfo("/r/b.md"),
      mkInfo("/r/c.md"),
      mkInfo("/r/orphan.md"),
    ]),
  );

  it("hideOrphans — 연결 0 노드 제거", () => {
    const f = filterDocGraph(base, { hideOrphans: true });
    expect(f.nodes.some((n) => n.id === "/r/orphan.md")).toBe(false);
    expect(f.nodes.some((n) => n.id === "/r/hub.md")).toBe(true);
    expect(f.totalNodes).toBe(5);
    expect(f.shownNodes).toBe(4);
  });

  it("degreeCap — degree 초과 허브 + 그 엣지 숨김", () => {
    const f = filterDocGraph(base, { degreeCap: 2 }); // hub degree 3 → 숨김
    expect(f.nodes.some((n) => n.id === "/r/hub.md")).toBe(false);
    expect(f.edges.some((e) => e.source === "/r/hub.md")).toBe(false);
  });

  it("minWeight — weight 미만 엣지 제거 (백본)", () => {
    expect(filterDocGraph(base, { minWeight: 2 }).edges).toHaveLength(0); // 모든 weight 1
    expect(filterDocGraph(base, { minWeight: 1 }).edges.length).toBeGreaterThan(0);
  });

  it("types — 해당 type만 (type null 노드 제외)", () => {
    const typed = buildDocumentGraph(
      buildIndex([
        mkInfo("/r/p.md", { docKind: "plan", targets: ["s"] }),
        mkInfo("/r/s.md", { docKind: "solution" }),
      ]),
    );
    const f = filterDocGraph(typed, { types: new Set(["plan"]) });
    expect(f.nodes.map((n) => n.id)).toEqual(["/r/p.md"]);
  });

  it("필터 없으면 원본 그대로", () => {
    const f = filterDocGraph(base);
    expect(f.nodes.length).toBe(base.nodes.length);
    expect(f.edges.length).toBe(base.edges.length);
  });
});

describe("computeBetweenness — 다리 노트(온디맨드)", () => {
  it("경로 그래프 A→B→C→D→E: 중앙 C가 최대, 양끝 0, B==D", () => {
    const g = buildDocumentGraph(
      buildIndex([
        mkInfo("/r/a.md", { targets: ["b"] }),
        mkInfo("/r/b.md", { targets: ["c"] }),
        mkInfo("/r/c.md", { targets: ["d"] }),
        mkInfo("/r/d.md", { targets: ["e"] }),
        mkInfo("/r/e.md"),
      ]),
    );
    const bc = computeBetweenness(g.graph);
    // C는 가장 많은 최단경로가 통과 → 최대. 양끝(A=source, E=sink)은 0.
    expect(bc["/r/c.md"]).toBeGreaterThan(bc["/r/b.md"]);
    expect(bc["/r/c.md"]).toBeGreaterThan(bc["/r/d.md"]);
    expect(bc["/r/b.md"]).toBeCloseTo(bc["/r/d.md"], 6);
    expect(bc["/r/a.md"]).toBe(0);
    expect(bc["/r/e.md"]).toBe(0);
  });

  it("두 군집을 잇는 다리 노트가 양 군집 내부 노드보다 높음", () => {
    // 군집1: a1→a2→bridge, 군집2: bridge→b1→b2 — bridge가 유일한 통로.
    const g = buildDocumentGraph(
      buildIndex([
        mkInfo("/r/a1.md", { targets: ["a2"] }),
        mkInfo("/r/a2.md", { targets: ["bridge"] }),
        mkInfo("/r/bridge.md", { targets: ["b1"] }),
        mkInfo("/r/b1.md", { targets: ["b2"] }),
        mkInfo("/r/b2.md"),
      ]),
    );
    const bc = computeBetweenness(g.graph);
    expect(bc["/r/bridge.md"]).toBeGreaterThan(bc["/r/a2.md"]);
    expect(bc["/r/bridge.md"]).toBeGreaterThan(bc["/r/b1.md"]);
  });

  it("엣지 없는 그래프 → 빈 맵", () => {
    const g = buildDocumentGraph(buildIndex([mkInfo("/r/a.md"), mkInfo("/r/b.md")]));
    expect(computeBetweenness(g.graph)).toEqual({});
  });

  it("빈 그래프 → 빈 맵", () => {
    const g = buildDocumentGraph(buildIndex([]));
    expect(computeBetweenness(g.graph)).toEqual({});
  });
});

describe("disparityBackbone — 노드-로컬 통계 백본", () => {
  it("삼각형에서 약한 변 제거, 강한 변 유지 (α=0.5)", () => {
    // A-B(10), B-C(10) 강한 변 + A-C(1) 약한 변. 모든 노드 degree 2.
    const keep = disparityBackbone(
      [
        { source: "A", target: "B", weight: 10 },
        { source: "B", target: "C", weight: 10 },
        { source: "A", target: "C", weight: 1 },
      ],
      0.5,
    );
    expect(keep.has(edgeKey("A", "B"))).toBe(true);
    expect(keep.has(edgeKey("B", "C"))).toBe(true);
    expect(keep.has(edgeKey("A", "C"))).toBe(false);
  });

  it("α를 크게 하면 약한 변도 유지(덜 엄격)", () => {
    const edges = [
      { source: "A", target: "B", weight: 10 },
      { source: "B", target: "C", weight: 10 },
      { source: "A", target: "C", weight: 1 },
    ];
    expect(disparityBackbone(edges, 0.95).has(edgeKey("A", "C"))).toBe(true);
  });

  it("degree 1 노드의 유일 엣지는 α가 아무리 작아도 보존(고아화 방지)", () => {
    const keep = disparityBackbone([{ source: "A", target: "B", weight: 5 }], 0.01);
    expect(keep.has(edgeKey("A", "B"))).toBe(true);
  });

  it("양방향 directed 엣지는 무방향 페어로 묶여 운명 공유", () => {
    // A↔B 약한 양방향 + A-C, A-D 강한 변 → A 관점에서 A-B 약함.
    const keep = disparityBackbone(
      [
        { source: "A", target: "B", weight: 1 },
        { source: "B", target: "A", weight: 1 },
        { source: "A", target: "C", weight: 10 },
        { source: "A", target: "D", weight: 10 },
        { source: "C", target: "X", weight: 5 },
        { source: "D", target: "Y", weight: 5 },
      ],
      0.3,
    );
    // A↔B 두 방향은 함께 유지되거나 함께 제거됨(같은 무방향 페어).
    expect(keep.has(edgeKey("A", "B"))).toBe(keep.has(edgeKey("B", "A")));
  });

  it("빈 엣지 → 빈 집합", () => {
    expect(disparityBackbone([], 0.3).size).toBe(0);
  });
});

describe("filterDocGraph — disparity 백본 모드", () => {
  function mkNode(id: string): DocGraphNode {
    return { id, label: id, folder: null, degree: 2, pagerank: 0, community: 0, type: null };
  }
  const src = {
    nodes: ["A", "B", "C"].map(mkNode),
    edges: [
      { source: "A", target: "B", weight: 10 },
      { source: "B", target: "C", weight: 10 },
      { source: "A", target: "C", weight: 1 },
    ],
  };

  it("backboneMode=disparity면 약한 변 A→C 제거", () => {
    const f = filterDocGraph(src, { backboneMode: "disparity", disparityAlpha: 0.5 });
    const keys = f.edges.map((e) => `${e.source}->${e.target}`);
    expect(keys).toContain("A->B");
    expect(keys).toContain("B->C");
    expect(keys).not.toContain("A->C");
  });

  it("기본(minWeight) 모드는 disparity와 다름 — 모든 변 유지", () => {
    const f = filterDocGraph(src, { minWeight: 1 });
    expect(f.edges).toHaveLength(3);
  });
});
