import type { LinkIndex } from "$lib/linkIndex";
import {
  type DocGraphNode,
  type DocGraphEdge,
  projectOf,
  nodeType,
  isExcluded,
  resolveBodyTargets,
  collectWeightedEdges,
  DEFAULT_EXCLUDED_FOLDERS,
} from "$lib/documentGraph";

/**
 * PR-G2′ — Local/ego 모드 데이터 (ADR-003).
 *
 * 헤어볼 해결 1순위 = **범위 축소**. 전체 vault 그래프(documentGraph, ~12k노트)를
 * 빌드하지 않고 LinkIndex에서 **현재 노트 주변만 직접 BFS**한다. 빌드 비용 0에 가깝게.
 *
 * - **depth**: 중심에서 자동 BFS hop(1~2).
 * - **topN cap**: 노드당 자동 표시 이웃 상한(연결 강도 weight 우선). 초과분은 `hiddenNeighbors`
 *   카운트 → UI "+N more" 배지. 헤어볼 원천 회피(van Ham & Perer "expand on demand").
 * - **expanded**: 사용자가 펼친 노드는 cap 없이 전체 이웃 표시(클릭=확장). 멱등·결정론.
 *
 * 엣지 정의(본문 링크 + frontmatter 관계, weight 합산, `_memories` 제외)는
 * documentGraph와 **공유**(collectWeightedEdges 등)해 전역/국소 일관성 유지.
 * community/PageRank는 Global(G3′) 전용 — local은 folder 색 + 로컬 degree로 충분.
 */

export interface EgoNode extends DocGraphNode {
  /** 중심으로부터 hop 거리(0=중심). */
  depth: number;
  /** 표시되지 않은 이웃 수(전체 이웃 − 화면 표시 이웃) — "+N more" 배지. */
  hiddenNeighbors: number;
}

export interface EgoGraph {
  /** 중심 노트 경로. */
  center: string;
  nodes: EgoNode[];
  edges: DocGraphEdge[];
  /** maxNodes 가드로 일부 이웃이 잘렸는지. */
  truncated: boolean;
}

export interface EgoGraphOptions {
  /** 자동 BFS hop(1~2). 기본 1. */
  depth?: number;
  /** 노드당 자동 표시 이웃 상한(weight 우선). 기본 12. */
  topN?: number;
  /** 펼친 노드 — cap 없이 전체 이웃 표시. 기본 빈 집합. */
  expanded?: ReadonlySet<string>;
  /** 안전 가드 — 화면 노드 상한. 기본 250. */
  maxNodes?: number;
  /** 노이즈 폴더 제외. 기본 `["_memories"]`. 중심 자신은 제외 대상이어도 항상 표시. */
  excludeFolders?: string[];
  /** folder 추출용 vault 루트. */
  vaultRoot?: string;
}

/**
 * 노트의 **무방향** 이웃 → 연결 강도(weight). outgoing/incoming 관계 + 본문 링크 +
 * 백링크를 합산. 제외 폴더 이웃은 뺀다. 우선순위(topN) 정렬과 hiddenNeighbors의 기준.
 */
function neighborWeights(
  path: string,
  idx: LinkIndex,
  excluded: Set<string>,
): Map<string, number> {
  const w = new Map<string, number>();
  const bump = (p: string) => {
    if (p === path || !idx.byPath.has(p) || isExcluded(p, excluded)) return;
    w.set(p, (w.get(p) ?? 0) + 1);
  };
  for (const r of idx.relations.outgoing.get(path) ?? []) bump(r.path);
  for (const r of idx.relations.incoming.get(path) ?? []) bump(r.path);
  const info = idx.byPath.get(path);
  if (info) for (const t of resolveBodyTargets(info, idx)) bump(t);
  for (const s of idx.backlinks.get(path) ?? []) bump(s);
  return w;
}

/** weight 내림차순 + path 사전순(결정론) 정렬된 이웃 경로 목록. */
function orderedNeighbors(weights: Map<string, number>): string[] {
  return [...weights.entries()]
    .sort((a, b) =>
      b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    )
    .map((e) => e[0]);
}

/**
 * 현재 노트 중심 ego 그래프. 같은 입력·옵션 → 같은 출력(멱등·결정론).
 */
export function buildEgoGraph(
  idx: LinkIndex,
  centerPath: string,
  opts: EgoGraphOptions = {},
): EgoGraph {
  const depth = Math.max(1, opts.depth ?? 1);
  const topN = Math.max(0, opts.topN ?? 12);
  const expanded = opts.expanded ?? new Set<string>();
  const maxNodes = Math.max(1, opts.maxNodes ?? 250);
  const excluded = new Set(opts.excludeFolders ?? DEFAULT_EXCLUDED_FOLDERS);
  const vaultRoot = opts.vaultRoot ?? "";

  const nodeSet = new Set<string>();
  const depthOf = new Map<string, number>();
  let truncated = false;

  const tryAdd = (p: string, d: number): boolean => {
    if (nodeSet.has(p)) return false;
    if (nodeSet.size >= maxNodes) {
      truncated = true;
      return false;
    }
    nodeSet.add(p);
    depthOf.set(p, d);
    return true;
  };

  // 이웃 weight 캐시 — BFS·expand·hiddenNeighbors가 같은 노드를 반복 조회.
  const cache = new Map<string, Map<string, number>>();
  const neighborsOf = (p: string): Map<string, number> => {
    let w = cache.get(p);
    if (!w) {
      w = neighborWeights(p, idx, excluded);
      cache.set(p, w);
    }
    return w;
  };

  // 중심 — 제외 폴더여도 사용자가 명시적으로 연 노트이므로 항상 포함.
  tryAdd(centerPath, 0);

  // 1) 중심에서 BFS depth hop. 노드당 topN cap(expanded 노드는 cap 없음).
  let frontier = [centerPath];
  for (let level = 1; level <= depth && !truncated; level++) {
    const next: string[] = [];
    for (const p of frontier) {
      const ordered = orderedNeighbors(neighborsOf(p));
      const cap = expanded.has(p) ? ordered.length : topN;
      for (let i = 0; i < ordered.length && i < cap; i++) {
        if (tryAdd(ordered[i], level)) next.push(ordered[i]);
        if (truncated) break;
      }
      if (truncated) break;
    }
    frontier = next;
  }

  // 2) expanded 노드의 전체 이웃을 추가(depth 밖이라도). 새로 펼친 노드까지 수렴.
  let added = true;
  while (added && !truncated) {
    added = false;
    for (const e of [...expanded].sort()) {
      if (!nodeSet.has(e)) continue;
      const d = (depthOf.get(e) ?? 0) + 1;
      for (const nb of orderedNeighbors(neighborsOf(e))) {
        if (nodeSet.has(nb)) continue;
        if (tryAdd(nb, d)) added = true;
        if (truncated) break;
      }
      if (truncated) break;
    }
  }

  // 3) 엣지 — nodeSet 한정, documentGraph와 동일 정의(가중·방향).
  const edges: DocGraphEdge[] = [];
  for (const { source, target, weight } of collectWeightedEdges(nodeSet, idx).values()) {
    edges.push({ source, target, weight });
  }

  // 4) 로컬 degree(표시 엣지 in+out).
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  // 5) 노드 + hiddenNeighbors(전체 이웃 − 표시 이웃).
  const nodes: EgoNode[] = [];
  for (const path of nodeSet) {
    const info = idx.byPath.get(path);
    const neighbors = neighborsOf(path);
    let shown = 0;
    for (const nb of neighbors.keys()) if (nodeSet.has(nb)) shown++;
    nodes.push({
      id: path,
      label: info?.title ?? info?.source_name ?? path,
      folder: projectOf(path, vaultRoot),
      type: nodeType(info),
      degree: degree.get(path) ?? 0,
      pagerank: 0, // local 미계산 — Global(G3′) 전용
      community: 0, // local 미계산 — folder 색 사용
      depth: depthOf.get(path) ?? 0,
      hiddenNeighbors: Math.max(0, neighbors.size - shown),
    });
  }

  return { center: centerPath, nodes, edges, truncated };
}
