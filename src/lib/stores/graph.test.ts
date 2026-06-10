import { describe, it, expect } from "vitest";
import {
  EMPTY_GRAPH,
  openGraphState,
  closeGraphState,
  toggleExpandedState,
  setDepthState,
  recenterState,
  setModeState,
  setColorModeState,
  setSizeModeState,
  setFiltersState,
  toggleTypeFilterState,
  MIN_DEPTH,
  MAX_DEPTH,
  type GraphState,
} from "./graph";

describe("openGraphState", () => {
  it("open=true + centerPath, expanded 초기화, depth 유지", () => {
    const base: GraphState = { ...EMPTY_GRAPH, depth: 2, expanded: new Set(["/x.md"]) };
    const s = openGraphState(base, "/a.md");
    expect(s.open).toBe(true);
    expect(s.centerPath).toBe("/a.md");
    expect(s.depth).toBe(2);
    expect(s.expanded.size).toBe(0);
  });
});

describe("closeGraphState", () => {
  it("open=false, 나머지 보존", () => {
    const s = closeGraphState({ ...EMPTY_GRAPH, open: true, centerPath: "/a.md" });
    expect(s.open).toBe(false);
    expect(s.centerPath).toBe("/a.md");
  });
});

describe("toggleExpandedState", () => {
  it("없으면 추가, 있으면 제거 (불변 — 새 Set)", () => {
    const s0 = EMPTY_GRAPH;
    const s1 = toggleExpandedState(s0, "/a.md");
    expect(s1.expanded.has("/a.md")).toBe(true);
    expect(s0.expanded.has("/a.md")).toBe(false); // 원본 불변
    const s2 = toggleExpandedState(s1, "/a.md");
    expect(s2.expanded.has("/a.md")).toBe(false);
  });
});

describe("setDepthState", () => {
  it("범위 clamp", () => {
    expect(setDepthState(EMPTY_GRAPH, 5).depth).toBe(MAX_DEPTH);
    expect(setDepthState(EMPTY_GRAPH, 0).depth).toBe(MIN_DEPTH);
  });
  it("변경 시 expanded 초기화", () => {
    const base: GraphState = { ...EMPTY_GRAPH, depth: 1, expanded: new Set(["/x.md"]) };
    const s = setDepthState(base, 2);
    expect(s.depth).toBe(2);
    expect(s.expanded.size).toBe(0);
  });
  it("동일 depth면 no-op(참조 유지)", () => {
    const base: GraphState = { ...EMPTY_GRAPH, depth: 1, expanded: new Set(["/x.md"]) };
    expect(setDepthState(base, 1)).toBe(base);
  });
});

describe("recenterState", () => {
  it("중심 교체 + expanded 초기화", () => {
    const base: GraphState = {
      ...EMPTY_GRAPH,
      open: true,
      centerPath: "/a.md",
      expanded: new Set(["/x.md"]),
    };
    const s = recenterState(base, "/b.md");
    expect(s.centerPath).toBe("/b.md");
    expect(s.open).toBe(true);
    expect(s.expanded.size).toBe(0);
  });
  it("같은 중심이면 no-op", () => {
    const base: GraphState = { ...EMPTY_GRAPH, centerPath: "/a.md" };
    expect(recenterState(base, "/a.md")).toBe(base);
  });
});

describe("setModeState", () => {
  it("local↔global 전환 + expanded 초기화", () => {
    const base: GraphState = { ...EMPTY_GRAPH, mode: "local", expanded: new Set(["/x.md"]) };
    const s = setModeState(base, "global");
    expect(s.mode).toBe("global");
    expect(s.expanded.size).toBe(0);
  });
  it("같은 모드면 no-op", () => {
    const base: GraphState = { ...EMPTY_GRAPH, mode: "local" };
    expect(setModeState(base, "local")).toBe(base);
  });
});

describe("setColorModeState", () => {
  it("색 기준 변경", () => {
    expect(setColorModeState(EMPTY_GRAPH, "folder").colorMode).toBe("folder");
  });
  it("같으면 no-op", () => {
    const base: GraphState = { ...EMPTY_GRAPH, colorMode: "community" };
    expect(setColorModeState(base, "community")).toBe(base);
  });
});

describe("setSizeModeState", () => {
  it("degree↔pagerank 변경", () => {
    expect(setSizeModeState(EMPTY_GRAPH, "pagerank").sizeMode).toBe("pagerank");
  });
  it("같으면 no-op", () => {
    const base: GraphState = { ...EMPTY_GRAPH, sizeMode: "degree" };
    expect(setSizeModeState(base, "degree")).toBe(base);
  });
});

describe("setFiltersState", () => {
  it("부분 갱신 — 나머지 필터 보존", () => {
    const s = setFiltersState(EMPTY_GRAPH, { hideOrphans: true });
    expect(s.filters.hideOrphans).toBe(true);
    expect(s.filters.minWeight).toBe(EMPTY_GRAPH.filters.minWeight);
    expect(s.filters.degreeCap).toBeNull();
  });
  it("degreeCap·minWeight 설정", () => {
    const s = setFiltersState(EMPTY_GRAPH, { degreeCap: 50, minWeight: 2 });
    expect(s.filters.degreeCap).toBe(50);
    expect(s.filters.minWeight).toBe(2);
  });
  it("기본 types는 빈 배열(전체)", () => {
    expect(EMPTY_GRAPH.filters.types).toEqual([]);
  });
});

describe("toggleTypeFilterState", () => {
  it("없으면 추가, 있으면 제거 (다른 필터 보존)", () => {
    let s = toggleTypeFilterState(EMPTY_GRAPH, "plan");
    expect(s.filters.types).toEqual(["plan"]);
    expect(s.filters.hideOrphans).toBe(EMPTY_GRAPH.filters.hideOrphans); // 보존
    s = toggleTypeFilterState(s, "solution");
    expect(s.filters.types).toEqual(["plan", "solution"]);
    s = toggleTypeFilterState(s, "plan");
    expect(s.filters.types).toEqual(["solution"]);
  });
  it("불변 — 원본 배열 변경 안 함", () => {
    const s0 = toggleTypeFilterState(EMPTY_GRAPH, "plan");
    toggleTypeFilterState(s0, "spec");
    expect(s0.filters.types).toEqual(["plan"]);
  });
});
