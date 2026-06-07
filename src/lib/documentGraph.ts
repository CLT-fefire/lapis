import { DirectedGraph } from "graphology";
import louvain from "graphology-communities-louvain";
import pagerank from "graphology-metrics/centrality/pagerank";
import type { LinkIndex } from "$lib/linkIndex";
import { targetName } from "$lib/linkIndex";
import type { LinkInfo } from "$lib/tauri/notes";

/**
 * PR-G1′ — 문서 단위 지식 그래프 **데이터 모델** (ADR-003).
 *
 * LinkIndex(이미 빌드된 본문 링크 + frontmatter 관계) → graphology 가중·방향 그래프
 * + 파생 메트릭(degree / PageRank / Louvain community). **순수 함수** — UI/렌더 없음.
 * Local/ego(G2′)·Global 풀스택(G3′)·시각 인코딩(G4′)이 이 모델 위에 얹힌다.
 *
 * 헤어볼 해결의 1차 원리: "전부를 평면으로 한 번에 그리지 않는다." 그 첫 단계가
 * 노이즈 배제 + 구조(community)·중심성(degree/PageRank)을 미리 계산해 두는 것.
 *
 * 핵심 결정(ADR-003 결정표):
 * - 노드 = 문서(.md). 엣지 = 본문 wikilink/md-link + frontmatter 관계, **방향 보존**,
 *   같은 ordered pair의 다중 기여는 **1 weighted 엣지로 집계**(weight = 기여 수).
 * - 노이즈 배제: `_memories`(자동 export) 등 폴더 기준 제외 → MEMORY 원기옥(degree 13,910) 소멸.
 * - community = Louvain(**RNG seed 고정** → 색 안정 + **연결요소 후split** → 끊긴 색 방지),
 *   `resolution` = 입도 파라미터.
 * - 중심성 = degree 기본 + PageRank(거의 무비용). betweenness는 온디맨드(후속).
 */

import type { Attributes } from "graphology-types";

/** 노이즈 폴더 기본 제외 목록 — 경로 세그먼트 어디든 일치하면 제외. */
export const DEFAULT_EXCLUDED_FOLDERS = ["_memories"];

/** Louvain RNG 기본 seed — 고정해 community 색이 빌드마다 흔들리지 않게 한다. */
export const DEFAULT_SEED = 0x1a91;

export interface DocGraphNode {
  /** 노트 절대 경로. */
  id: string;
  /** 표시명 = title ?? source_name. */
  label: string;
  /** 최상위 폴더(프로젝트) — 색 folder 토글용. vaultRoot 미지정/루트직속이면 null. */
  folder: string | null;
  /** total degree(in+out) — 크기 인코딩 기본. */
  degree: number;
  /** PageRank 점수(가중·방향) — 크기 인코딩 토글. 엣지 없으면 0. */
  pagerank: number;
  /** Louvain community(연결요소 split + 크기 내림차순 안정 재번호) — 색 community 토글용. */
  community: number;
}

export interface DocGraphEdge {
  source: string;
  target: string;
  /** 같은 ordered pair의 기여(관계 + 본문링크) 합산. */
  weight: number;
}

export interface DocGraph {
  /**
   * graphology 인스턴스(가중·방향, 노드 attribute에 메트릭 포함).
   * G2′/G3′에서 이웃 쿼리·ego 추출·렌더에 직접 재사용한다.
   */
  graph: DirectedGraph<DocNodeAttributes, DocEdgeAttributes>;
  nodes: DocGraphNode[];
  edges: DocGraphEdge[];
  /** split 후 community 개수. */
  communityCount: number;
  /** 노이즈 폴더로 제외된 노트 수(진단/안내용). */
  excludedCount: number;
}

export interface DocNodeAttributes extends Attributes {
  label: string;
  folder: string | null;
  degree: number;
  pagerank: number;
  community: number;
}

export interface DocEdgeAttributes extends Attributes {
  weight: number;
}

export interface BuildDocGraphOptions {
  /** 제외 폴더(경로 세그먼트). 기본 `["_memories"]`. */
  excludeFolders?: string[];
  /** Louvain 입도 — 클수록 작은 community 많아짐. 기본 1. */
  resolution?: number;
  /** Louvain RNG seed — 색 안정성. 기본 `DEFAULT_SEED`. */
  seed?: number;
  /** 최상위 폴더 추출용 vault 루트 절대 경로. 미지정 시 folder=null. */
  vaultRoot?: string;
}

/**
 * 노트 path에서 프로젝트(최상위 폴더) 추출. 루트 직속/vault 밖이면 null.
 * 예: `/root/lapis/plans/foo.md`(root=`/root`) → "lapis". `/root/foo.md` → null.
 */
export function projectOf(path: string, vaultRoot: string): string | null {
  if (!vaultRoot || !path.startsWith(vaultRoot)) return null;
  let rel = path.slice(vaultRoot.length);
  if (rel.startsWith("/")) rel = rel.slice(1);
  const slash = rel.indexOf("/");
  if (slash === -1) return null; // 루트 직속 — 프로젝트 폴더 없음
  return rel.slice(0, slash);
}

/** 경로 세그먼트 중 제외 폴더가 하나라도 있으면 true. */
function isExcluded(path: string, excluded: Set<string>): boolean {
  if (excluded.size === 0) return false;
  for (const seg of path.split("/")) {
    if (excluded.has(seg)) return true;
  }
  return false;
}

/** 노트의 본문 링크(targets)를 resolver로 노트 path로 해석(자기 자신 제외). */
function resolveBodyTargets(info: LinkInfo, idx: LinkIndex): string[] {
  const out: string[] = [];
  for (const raw of info.targets) {
    const p = idx.resolver.get(targetName(raw).toLowerCase());
    if (p && p !== info.source_path) out.push(p);
  }
  return out;
}

/** 32비트 seed 결정론적 PRNG(mulberry32) — 외부 의존성 없이 Louvain RNG 고정. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Louvain raw 매핑을 (1) 같은 community 내 **무방향 연결요소**로 후split 하고
 * (2) 크기 내림차순(동률은 대표 노드 id 사전순)으로 안정 재번호 한다.
 *
 * Louvain은 드물게 끊긴 노드 묶음에 같은 번호를 줄 수 있고(끊긴 색),
 * 번호 자체도 실행마다 흔들린다. split + 결정론적 재번호로 둘 다 막는다.
 * 무방향 이웃은 `graph.neighbors`(in+out 합집합) = 약연결 컴포넌트.
 */
function splitDisconnectedCommunities(
  graph: DirectedGraph<DocNodeAttributes, DocEdgeAttributes>,
  raw: Record<string, number>,
): { mapping: Record<string, number>; count: number } {
  const visited = new Set<string>();
  const groups: string[][] = [];

  for (const node of graph.nodes()) {
    if (visited.has(node)) continue;
    const comm = raw[node];
    const group: string[] = [];
    const stack = [node];
    visited.add(node);
    while (stack.length) {
      const cur = stack.pop() as string;
      group.push(cur);
      for (const nb of graph.neighbors(cur)) {
        if (visited.has(nb) || raw[nb] !== comm) continue;
        visited.add(nb);
        stack.push(nb);
      }
    }
    groups.push(group);
  }

  // 대표 = 그룹 내 최소 id(사전순) → 동률 크기에서 결정론적 정렬.
  const ranked = groups.map((g) => ({
    g,
    rep: g.reduce((m, x) => (x < m ? x : m), g[0]),
  }));
  ranked.sort((a, b) =>
    b.g.length !== a.g.length
      ? b.g.length - a.g.length
      : a.rep < b.rep
        ? -1
        : a.rep > b.rep
          ? 1
          : 0,
  );

  const mapping: Record<string, number> = {};
  ranked.forEach(({ g }, i) => {
    for (const n of g) mapping[n] = i;
  });
  return { mapping, count: ranked.length };
}

/**
 * LinkIndex → 문서 그래프 + 메트릭. 결정론적(같은 입력·옵션 → 같은 출력).
 */
export function buildDocumentGraph(
  idx: LinkIndex,
  opts: BuildDocGraphOptions = {},
): DocGraph {
  const excluded = new Set(opts.excludeFolders ?? DEFAULT_EXCLUDED_FOLDERS);
  const resolution = opts.resolution ?? 1;
  const seed = opts.seed ?? DEFAULT_SEED;
  const vaultRoot = opts.vaultRoot ?? "";

  // 1) 포함 노드 결정 (노이즈 폴더 제외). 첨부는 .md만 스캔되므로 byPath에 애초에 없음.
  const included = new Set<string>();
  let excludedCount = 0;
  for (const path of idx.byPath.keys()) {
    if (isExcluded(path, excluded)) {
      excludedCount++;
      continue;
    }
    included.add(path);
  }

  // 2) 엣지 기여 집계 — 방향 보존, 같은 ordered pair는 weight 합산.
  const edgeAgg = new Map<string, { source: string; target: string; weight: number }>();
  const addEdge = (source: string, target: string) => {
    if (source === target) return;
    if (!included.has(source) || !included.has(target)) return;
    const key = `${source} ${target}`;
    const cur = edgeAgg.get(key);
    if (cur) cur.weight += 1;
    else edgeAgg.set(key, { source, target, weight: 1 });
  };
  for (const path of included) {
    // frontmatter 타입 관계(방향). outgoing만 순회하면 모든 엣지 1회씩.
    for (const r of idx.relations.outgoing.get(path) ?? []) addEdge(path, r.path);
    // 본문 wikilink/md-link(방향).
    const info = idx.byPath.get(path);
    if (info) for (const tgt of resolveBodyTargets(info, idx)) addEdge(path, tgt);
  }

  // 3) graphology DirectedGraph 빌드.
  const graph = new DirectedGraph<DocNodeAttributes, DocEdgeAttributes>({
    allowSelfLoops: false,
  });
  for (const path of included) {
    const info = idx.byPath.get(path);
    graph.addNode(path, {
      label: info?.title ?? info?.source_name ?? path,
      folder: projectOf(path, vaultRoot),
      degree: 0,
      pagerank: 0,
      community: 0,
    });
  }
  for (const { source, target, weight } of edgeAgg.values()) {
    graph.addDirectedEdge(source, target, { weight });
  }

  // 4) PageRank(가중·방향). 엣지 없으면 균등 — 의미 없으므로 0 유지.
  let pr: Record<string, number> = {};
  if (graph.order > 0 && graph.size > 0) {
    pr = pagerank(graph, { getEdgeWeight: "weight" });
  }

  // 5) Louvain community. seed 고정 RNG + resolution. 엣지 없으면 각 노드 단독.
  let rawCommunity: Record<string, number> = {};
  if (graph.order > 0) {
    if (graph.size > 0) {
      rawCommunity = louvain(graph, {
        resolution,
        rng: mulberry32(seed),
        getEdgeWeight: "weight",
      });
    } else {
      let c = 0;
      for (const n of graph.nodes()) rawCommunity[n] = c++;
    }
  }

  // 6) 연결요소 후split + 안정 재번호.
  const { mapping: community, count: communityCount } = splitDisconnectedCommunities(
    graph,
    rawCommunity,
  );

  // 7) 노드 attribute에 메트릭 기록 + 출력 배열 생성.
  const nodes: DocGraphNode[] = [];
  for (const path of graph.nodes()) {
    const attr = graph.getNodeAttributes(path);
    const degree = graph.degree(path);
    const pagerankScore = pr[path] ?? 0;
    const comm = community[path] ?? 0;
    graph.mergeNodeAttributes(path, {
      degree,
      pagerank: pagerankScore,
      community: comm,
    });
    nodes.push({
      id: path,
      label: attr.label,
      folder: attr.folder,
      degree,
      pagerank: pagerankScore,
      community: comm,
    });
  }

  const edges: DocGraphEdge[] = [];
  graph.forEachDirectedEdge((_edge, attr, source, target) => {
    edges.push({ source, target, weight: attr.weight });
  });

  return { graph, nodes, edges, communityCount, excludedCount };
}
