import { describe, it, expect } from "vitest";
import {
  EMPTY_GRAPH,
  openGraphState,
  closeGraphState,
  toggleExpandedState,
  setDepthState,
  recenterState,
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
