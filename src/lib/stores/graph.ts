import { writable, derived } from "svelte/store";

/**
 * PR-G2′ — Local/ego 그래프 모달 상태 (ADR-003).
 *
 * 세션성(비영속). 현재 노트를 중심으로 ego 그래프를 띄우고, depth 슬라이더와
 * expand-on-demand(노드 클릭 → 그 노드의 전체 이웃 펼침)를 제어한다.
 * 순수 reducer로 분리해 vitest 가능(Tauri webview 렌더는 사용자 육안검증).
 */
export interface GraphState {
  open: boolean;
  /** ego 중심 노트 절대 경로. */
  centerPath: string | null;
  /** 자동 BFS hop(1~2). */
  depth: number;
  /** 사용자가 펼친 노드(전체 이웃 표시). */
  expanded: Set<string>;
}

export const MIN_DEPTH = 1;
export const MAX_DEPTH = 2;
export const DEFAULT_DEPTH = 1;

export const EMPTY_GRAPH: GraphState = {
  open: false,
  centerPath: null,
  depth: DEFAULT_DEPTH,
  expanded: new Set(),
};

function clampDepth(depth: number): number {
  return Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, Math.round(depth)));
}

/** 중심 노트로 그래프를 연다. expand 상태는 초기화(새 범위). depth는 유지. */
export function openGraphState(state: GraphState, centerPath: string): GraphState {
  return { open: true, centerPath, depth: state.depth, expanded: new Set() };
}

export function closeGraphState(state: GraphState): GraphState {
  return { ...state, open: false };
}

/** 노드 펼침 토글(expand-on-demand). */
export function toggleExpandedState(state: GraphState, path: string): GraphState {
  const expanded = new Set(state.expanded);
  if (expanded.has(path)) expanded.delete(path);
  else expanded.add(path);
  return { ...state, expanded };
}

/** depth 변경 — 범위는 새로 잡히므로 expand 초기화. */
export function setDepthState(state: GraphState, depth: number): GraphState {
  const next = clampDepth(depth);
  if (next === state.depth) return state;
  return { ...state, depth: next, expanded: new Set() };
}

/** 중심 노트만 교체(모달 유지) — 그래프 안에서 다른 노트로 focus 이동 시. */
export function recenterState(state: GraphState, centerPath: string): GraphState {
  if (centerPath === state.centerPath) return state;
  return { ...state, centerPath, expanded: new Set() };
}

// === store (세션성 — localStorage 영속화 X) ===

const graphState = writable<GraphState>(EMPTY_GRAPH);

/** UI 구독용 readonly 뷰. */
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
