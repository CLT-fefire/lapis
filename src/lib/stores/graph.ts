import { writable, derived } from "svelte/store";

/**
 * PR-G2′/G3′ — 그래프 모달 상태 (ADR-003). 세션성(비영속).
 *
 * 두 모드: **Local**(ego, 현재 노트 이웃 — depth + expand-on-demand) ·
 * **Global**(프로젝트 스코프 풀스택 — community 색 + 필터 + 백본).
 * 순수 reducer로 분리해 vitest 가능(Tauri webview 렌더는 사용자 육안검증).
 */
export type GraphMode = "local" | "global";
export type GraphColorMode = "folder" | "community" | "type";
export type GraphSizeMode = "degree" | "pagerank";

export interface GraphFilters {
  /** 고아(연결 0) 노드 숨김. */
  hideOrphans: boolean;
  /** min-weight 백본 — 이 미만 weight 엣지 숨김. */
  minWeight: number;
  /** degree-cap — 이 초과 degree 허브 숨김(원기옥 억제). null=무제한. */
  degreeCap: number | null;
}

export interface GraphState {
  open: boolean;
  /** local=ego 중심 노트, global=이 노트의 프로젝트 스코프 기준. */
  centerPath: string | null;
  mode: GraphMode;
  /** [local] 자동 BFS hop(1~2). */
  depth: number;
  /** [local] 펼친 노드(전체 이웃 표시). */
  expanded: Set<string>;
  /** [global] 색 기준. */
  colorMode: GraphColorMode;
  /** [global] 노드 크기 기준 — degree(기본) 또는 PageRank. */
  sizeMode: GraphSizeMode;
  /** [global] 필터. */
  filters: GraphFilters;
}

export const MIN_DEPTH = 1;
export const MAX_DEPTH = 2;
export const DEFAULT_DEPTH = 1;

export const DEFAULT_FILTERS: GraphFilters = {
  hideOrphans: false,
  minWeight: 1,
  degreeCap: null,
};

export const EMPTY_GRAPH: GraphState = {
  open: false,
  centerPath: null,
  mode: "local",
  depth: DEFAULT_DEPTH,
  expanded: new Set(),
  colorMode: "community",
  sizeMode: "degree",
  filters: DEFAULT_FILTERS,
};

function clampDepth(depth: number): number {
  return Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, Math.round(depth)));
}

/** 중심 노트로 연다. expand 초기화. mode/colorMode/filters/depth는 유지(사용자 선호 보존). */
export function openGraphState(state: GraphState, centerPath: string): GraphState {
  return { ...state, open: true, centerPath, expanded: new Set() };
}

export function closeGraphState(state: GraphState): GraphState {
  return { ...state, open: false };
}

/** 노드 펼침 토글(expand-on-demand, local). */
export function toggleExpandedState(state: GraphState, path: string): GraphState {
  const expanded = new Set(state.expanded);
  if (expanded.has(path)) expanded.delete(path);
  else expanded.add(path);
  return { ...state, expanded };
}

/** depth 변경(local) — 범위가 새로 잡히므로 expand 초기화. */
export function setDepthState(state: GraphState, depth: number): GraphState {
  const next = clampDepth(depth);
  if (next === state.depth) return state;
  return { ...state, depth: next, expanded: new Set() };
}

/** 중심 노트 교체(모달 유지) — 그래프 안에서 다른 노트로 focus 이동 시. */
export function recenterState(state: GraphState, centerPath: string): GraphState {
  if (centerPath === state.centerPath) return state;
  return { ...state, centerPath, expanded: new Set() };
}

/** local↔global 전환 — expand 초기화. */
export function setModeState(state: GraphState, mode: GraphMode): GraphState {
  if (mode === state.mode) return state;
  return { ...state, mode, expanded: new Set() };
}

/** 색 기준 변경(global). */
export function setColorModeState(state: GraphState, colorMode: GraphColorMode): GraphState {
  if (colorMode === state.colorMode) return state;
  return { ...state, colorMode };
}

/** 크기 기준 변경(global) — degree↔PageRank. */
export function setSizeModeState(state: GraphState, sizeMode: GraphSizeMode): GraphState {
  if (sizeMode === state.sizeMode) return state;
  return { ...state, sizeMode };
}

/** 필터 부분 갱신(global). */
export function setFiltersState(state: GraphState, patch: Partial<GraphFilters>): GraphState {
  return { ...state, filters: { ...state.filters, ...patch } };
}

// === store (세션성 — localStorage 영속화 X) ===

const graphState = writable<GraphState>(EMPTY_GRAPH);

export const graphView = derived(graphState, (s) => s);
export const graphOpen = derived(graphState, (s) => s.open);

export function openGraph(centerPath: string): void {
  graphState.update((s) => openGraphState(s, centerPath));
}
export function closeGraph(): void {
  graphState.update(closeGraphState);
}
export function toggleExpanded(path: string): void {
  graphState.update((s) => toggleExpandedState(s, path));
}
export function setGraphDepth(depth: number): void {
  graphState.update((s) => setDepthState(s, depth));
}
export function recenterGraph(centerPath: string): void {
  graphState.update((s) => recenterState(s, centerPath));
}
export function setGraphMode(mode: GraphMode): void {
  graphState.update((s) => setModeState(s, mode));
}
export function setGraphColorMode(colorMode: GraphColorMode): void {
  graphState.update((s) => setColorModeState(s, colorMode));
}
export function setGraphSizeMode(sizeMode: GraphSizeMode): void {
  graphState.update((s) => setSizeModeState(s, sizeMode));
}
export function setGraphFilters(patch: Partial<GraphFilters>): void {
  graphState.update((s) => setFiltersState(s, patch));
}
