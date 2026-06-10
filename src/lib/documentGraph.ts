import { DirectedGraph } from "graphology";
import louvain from "graphology-communities-louvain";
import pagerank from "graphology-metrics/centrality/pagerank";
import betweenness from "graphology-metrics/centrality/betweenness";
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
  /** 노드 type(doc_kind ?? props.type 첫값) — 색 type 토글 + 필터용. 없으면 null. */
  type: string | null;
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
  type: string | null;
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
  /** 지정 시 해당 최상위 폴더(프로젝트)에 속한 노트만 포함(Global 프로젝트 스코프). vaultRoot 필요. */
  scopeFolders?: string[];
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

/** 노드 type — doc_kind 우선, 없으면 frontmatter `type` 첫값. 색 type 토글 + 필터용. */
export function nodeType(info: LinkInfo | undefined): string | null {
  if (!info) return null;
  if (info.doc_kind) return info.doc_kind;
  const t = info.props?.type?.[0]?.trim();
  return t || null;
}

/** 경로 세그먼트 중 제외 폴더가 하나라도 있으면 true. ego 모드와 공유. */
export function isExcluded(path: string, excluded: Set<string>): boolean {
  if (excluded.size === 0) return false;
  for (const seg of path.split("/")) {
    if (excluded.has(seg)) return true;
  }
  return false;
}

/** 노트의 본문 링크(targets)를 resolver로 노트 path로 해석(자기 자신 제외). ego 모드와 공유. */
export function resolveBodyTargets(info: LinkInfo, idx: LinkIndex): string[] {
  const out: string[] = [];
  for (const raw of info.targets) {
    const p = idx.resolver.get(targetName(raw).toLowerCase());
    if (p && p !== info.source_path) out.push(p);
  }
  return out;
}

/**
 * 포함 노드 집합에서 가중·방향 엣지를 집계. 같은 ordered pair의 다중 기여
 * (frontmatter 관계 + 본문 링크)는 weight 합산해 1엣지로. buildDocumentGraph(전체)와
 * buildEgoGraph(국소)가 **같은 엣지 정의**를 쓰도록 공유한다.
 */
/**
 * directed 엣지 key. 구분자 = U+0000(경로엔 안 나타나는 제어문자 — 공백/슬래시 충돌 회피).
 * 구분자를 String.fromCharCode(0)로 런타임 생성해 소스엔 raw NUL을 두지 않는다
 * (raw NUL은 git이 binary 취급 — 과거 사고). 엣지 집계 · disparity 백본 · 필터가
 * 같은 key를 쓰도록 단일 함수로 공유.
 */
const EDGE_SEP = String.fromCharCode(0);
export function edgeKey(source: string, target: string): string {
  return source + EDGE_SEP + target;
}

export function collectWeightedEdges(
  included: Set<string>,
  idx: LinkIndex,
): Map<string, { source: string; target: string; weight: number }> {
  const agg = new Map<string, { source: string; target: string; weight: number }>();
  const add = (source: string, target: string) => {
    if (source === target) return;
    if (!included.has(source) || !included.has(target)) return;
    const key = edgeKey(source, target);
    const cur = agg.get(key);
    if (cur) cur.weight += 1;
    else agg.set(key, { source, target, weight: 1 });
  };
  for (const path of included) {
    // frontmatter 타입 관계(방향). outgoing만 순회하면 모든 엣지 1회씩.
    for (const r of idx.relations.outgoing.get(path) ?? []) add(path, r.path);
    // 본문 wikilink/md-link(방향).
    const info = idx.byPath.get(path);
    if (info) for (const tgt of resolveBodyTargets(info, idx)) add(path, tgt);
  }
  return agg;
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

  // 1) 포함 노드 결정 (노이즈 폴더 제외 + 선택적 프로젝트 스코프).
  const scope =
    opts.scopeFolders && opts.scopeFolders.length > 0
      ? new Set(opts.scopeFolders)
      : null;
  const included = new Set<string>();
  let excludedCount = 0;
  for (const path of idx.byPath.keys()) {
    if (isExcluded(path, excluded)) {
      excludedCount++;
      continue;
    }
    // 스코프 지정 시 해당 프로젝트(최상위 폴더) 밖은 조용히 제외(노이즈 카운트엔 미포함).
    if (scope && !scope.has(projectOf(path, vaultRoot) ?? "")) continue;
    included.add(path);
  }

  // 2) 엣지 기여 집계 — 방향 보존, 같은 ordered pair는 weight 합산.
  const edgeAgg = collectWeightedEdges(included, idx);

  // 3) graphology DirectedGraph 빌드.
  const graph = new DirectedGraph<DocNodeAttributes, DocEdgeAttributes>({
    allowSelfLoops: false,
  });
  for (const path of included) {
    const info = idx.byPath.get(path);
    graph.addNode(path, {
      label: info?.title ?? info?.source_name ?? path,
      folder: projectOf(path, vaultRoot),
      type: nodeType(info),
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
      type: attr.type,
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

/**
 * betweenness 중심성("다리 노트") — **온디맨드** 계산(ADR-003 결정표 #7).
 *
 * O(V·E)라 buildDocumentGraph에서 미리 계산하지 않고, 크기 토글이 betweenness일 때만
 * 호출한다. **unweighted**(getEdgeWeight: null) — weight를 거리로 쓰면 "강도↑ = 거리↑"로
 * 의미가 뒤집히므로, 구조적 최단경로(hop) 기준으로 군집 사이를 잇는 다리 노트를 본다.
 * graphology 표준 정규화(normalized) 적용. 노드/엣지 없으면 빈 맵.
 *
 * 크기 인코딩 max 정규화는 호출부(GraphModal)에서 degree/PageRank와 동일하게 처리.
 */
export function computeBetweenness(
  graph: DirectedGraph<DocNodeAttributes, DocEdgeAttributes>,
): Record<string, number> {
  if (graph.order === 0 || graph.size === 0) return {};
  return betweenness(graph, { getEdgeWeight: null, normalized: true });
}

/** 백본 추출 방식 — 전역 임계(minWeight) 또는 노드-로컬 통계(disparity). */
export type BackboneMode = "minWeight" | "disparity";

/**
 * disparity filter 백본 (Serrano, Boguñá & Vespignani 2009, PNAS).
 *
 * min-weight 백본은 전역 임계 하나로 약한 엣지를 자르므로, 허브의 (절대값은 크지만) 약한
 * 엣지와 말단의 (절대값은 작지만 그 노드엔) 중요한 엣지를 구분하지 못한다. disparity filter는
 * **각 노드의 로컬 weight 분포**로 통계적 유의성을 본다 — 노드 i의 엣지 weight를 정규화
 * (p = w / strengthᵢ)하고 균등분포 귀무가설 대비 유의수준 αᵢⱼ = (1 − p)^(kᵢ − 1)을 구한 뒤,
 * **양 끝점 중 한쪽에서라도 유의(α < alpha)하면 유지**(OR). degree 1 노드의 유일 엣지는
 * 항상 유지(고아화 방지 — 표준 disparity filter 관행).
 *
 * 무방향 strength로 계산(지식 그래프 백본은 방향 무관). 같은 무방향 페어의 양방향 directed
 * 엣지는 weight를 합산해 한 번 판정하고 운명을 공유한다. 순수·결정론적.
 *
 * @param edges directed 엣지(`collectWeightedEdges`/`DocGraphEdge`와 동형).
 * @param alpha 유의수준(작을수록 백본이 sparse). 0~1.
 * @returns 유지할 directed 엣지 key 집합(`edgeKey(source, target)` 형식).
 */
export function disparityBackbone(
  edges: ReadonlyArray<{ source: string; target: string; weight: number }>,
  alpha: number,
): Set<string> {
  // 1) 무방향 페어로 weight 합산 + 멤버 directed key 수집.
  interface Pair {
    a: string;
    b: string;
    weight: number;
    members: string[];
  }
  const pairs = new Map<string, Pair>();
  for (const e of edges) {
    const [a, b] = e.source < e.target ? [e.source, e.target] : [e.target, e.source];
    const pk = edgeKey(a, b);
    let p = pairs.get(pk);
    if (!p) pairs.set(pk, (p = { a, b, weight: 0, members: [] }));
    p.weight += e.weight;
    p.members.push(edgeKey(e.source, e.target));
  }

  // 2) 노드별 strength(무방향 weight 합) + degree(무방향 페어 수).
  const strength = new Map<string, number>();
  const degree = new Map<string, number>();
  for (const p of pairs.values()) {
    strength.set(p.a, (strength.get(p.a) ?? 0) + p.weight);
    strength.set(p.b, (strength.get(p.b) ?? 0) + p.weight);
    degree.set(p.a, (degree.get(p.a) ?? 0) + 1);
    degree.set(p.b, (degree.get(p.b) ?? 0) + 1);
  }

  // 3) 한쪽이라도 유의(α<alpha)하거나 degree≤1이면 유지.
  const significant = (node: string, w: number): boolean => {
    const k = degree.get(node) ?? 0;
    if (k <= 1) return true; // 유일 엣지 — 보존(고아화 방지)
    const s = strength.get(node) ?? 0;
    if (s <= 0) return true;
    return Math.pow(1 - w / s, k - 1) < alpha;
  };

  const keep = new Set<string>();
  for (const p of pairs.values()) {
    if (significant(p.a, p.weight) || significant(p.b, p.weight)) {
      for (const m of p.members) keep.add(m);
    }
  }
  return keep;
}

export interface FilterOptions {
  /** 살아남은 엣지 기준 연결 0인 노드 숨김(고아 OFF). */
  hideOrphans?: boolean;
  /** 백본 방식 — "minWeight"(기본·전역 임계) 또는 "disparity"(노드-로컬 통계). */
  backboneMode?: BackboneMode;
  /** min-weight 백본 — weight 미만 엣지 제거. 기본 0(전체). backboneMode="minWeight"일 때. */
  minWeight?: number;
  /** disparity filter 유의수준(작을수록 sparse). 기본 0.3. backboneMode="disparity"일 때. */
  disparityAlpha?: number;
  /** degree-cap — 전역 degree가 cap 초과인 허브 노드 숨김(원기옥 억제). null=무제한. */
  degreeCap?: number | null;
  /** 지정 시 해당 type만(type null 노드는 제외). */
  types?: ReadonlySet<string> | null;
  /** 지정 시 해당 folder만(folder null 노드는 제외). */
  folders?: ReadonlySet<string> | null;
}

export interface FilteredGraph {
  nodes: DocGraphNode[];
  edges: DocGraphEdge[];
  /** 필터 전 노드 수. */
  totalNodes: number;
  /** 필터 후 표시 노드 수. */
  shownNodes: number;
}

/**
 * 빌드된 문서 그래프에 런타임 필터 적용(Global 모드). 순수·멱등.
 * degree/community 등 메트릭은 **전역 값 유지**(필터해도 중심성은 전체 기준).
 *
 * 순서: 노드 필터(degree-cap·type·folder) → 엣지 필터(백본 + 양끝 생존)
 * → 고아 정리(hideOrphans, 살아남은 엣지 기준).
 *
 * 백본 = backboneMode에 따라 **min-weight**(전역 임계) 또는 **disparity filter**(노드-로컬 통계).
 * disparity는 노드 필터 후 살아남은 엣지 집합에 적용한다(중심성은 전역, 백본은 표시 부분그래프 기준).
 */
export function filterDocGraph(
  source: { nodes: DocGraphNode[]; edges: DocGraphEdge[] },
  opts: FilterOptions = {},
): FilteredGraph {
  const minW = opts.minWeight ?? 0;
  const cap = opts.degreeCap ?? null;
  const types = opts.types ?? null;
  const folders = opts.folders ?? null;
  const backbone = opts.backboneMode ?? "minWeight";

  const kept = new Set<string>();
  for (const n of source.nodes) {
    if (cap != null && n.degree > cap) continue;
    if (types && (n.type == null || !types.has(n.type))) continue;
    if (folders && (n.folder == null || !folders.has(n.folder))) continue;
    kept.add(n.id);
  }

  // 노드 필터 생존 엣지 → 백본 적용.
  const candidate = source.edges.filter((e) => kept.has(e.source) && kept.has(e.target));
  let edges: DocGraphEdge[];
  if (backbone === "disparity") {
    const keepKeys = disparityBackbone(candidate, opts.disparityAlpha ?? 0.3);
    edges = candidate.filter((e) => keepKeys.has(edgeKey(e.source, e.target)));
  } else {
    edges = candidate.filter((e) => e.weight >= minW);
  }

  let nodes = source.nodes.filter((n) => kept.has(n.id));
  if (opts.hideOrphans) {
    const connected = new Set<string>();
    for (const e of edges) {
      connected.add(e.source);
      connected.add(e.target);
    }
    nodes = nodes.filter((n) => connected.has(n.id));
  }

  return { nodes, edges, totalNodes: source.nodes.length, shownNodes: nodes.length };
}
