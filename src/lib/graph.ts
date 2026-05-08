import type { LinkIndex } from "$lib/linkIndex";
import { resolveTarget, targetName } from "$lib/linkIndex";
import type { TagIndex } from "$lib/stores/tags";

export type GraphMode = "links" | "tags" | "both";

export interface GraphElement {
  data: {
    id: string;
    source?: string;
    target?: string;
    label?: string;
    parentDir?: string;
    kind?: "note" | "tag";
    edgeKind?: "link" | "tag";
    tagKey?: string;
  };
}

export interface GraphData {
  nodes: GraphElement[];
  edges: GraphElement[];
  isolatedCount: number;
}

export interface BuildGraphOptions {
  /** 현재 노트는 isolated여도 항상 포함 (사용자 컨텍스트 유지) */
  alwaysInclude?: string;
  /** isolated(엣지 없는) 노드 표시 여부. 기본 false — Obsidian 표준 */
  showIsolated?: boolean;
  /** 그래프 모드: links만 / tags만 / 둘 다. 기본 'both' */
  mode?: GraphMode;
  /** mode === 'tags' or 'both' 시 필수 */
  tagIndex?: TagIndex | null;
}

/**
 * linkIndex를 Cytoscape elements 형식으로 변환.
 * - 엣지: resolved wikilink/md link (방향 source → target). unresolved/self는 제외.
 * - 노드: 기본은 엣지에 참여한 노드만 (격자 fallback 회피).
 */
export function buildGraphData(index: LinkIndex, options?: BuildGraphOptions): GraphData {
  const mode: GraphMode = options?.mode ?? "both";
  const showIsolated = options?.showIsolated ?? false;
  const alwaysInclude = options?.alwaysInclude;
  const tagIndex = options?.tagIndex;

  const edges: GraphElement[] = [];
  const edgeKeys = new Set<string>();
  const connected = new Set<string>();
  const tagNodeIds = new Set<string>();

  // 1) Link 엣지 (links / both 모드)
  if (mode === "links" || mode === "both") {
    for (const [path, info] of index.byPath) {
      for (const raw of info.targets) {
        const name = targetName(raw);
        const targetPath = resolveTarget(name, index);
        if (!targetPath || targetPath === path) continue;
        const key = `link|${path}|${targetPath}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push({
          data: {
            id: `le:${edges.length}`,
            source: path,
            target: targetPath,
            edgeKind: "link",
          },
        });
        connected.add(path);
        connected.add(targetPath);
      }
    }
  }

  // 2) Tag 노드 + 노트→태그 엣지 (tags / both 모드)
  if ((mode === "tags" || mode === "both") && tagIndex) {
    for (const [tagKey, paths] of tagIndex.byTag) {
      const tagNodeId = `tag:${tagKey}`;
      tagNodeIds.add(tagNodeId);
      for (const notePath of paths) {
        const key = `tag|${notePath}|${tagNodeId}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push({
          data: {
            id: `te:${edges.length}`,
            source: notePath,
            target: tagNodeId,
            edgeKind: "tag",
          },
        });
        connected.add(notePath);
        connected.add(tagNodeId);
      }
    }
  }

  if (alwaysInclude) connected.add(alwaysInclude);

  // 3) Note 노드
  const nodes: GraphElement[] = [];
  let isolatedCount = 0;
  for (const [path, info] of index.byPath) {
    if (!showIsolated && !connected.has(path)) {
      isolatedCount++;
      continue;
    }
    const segs = path.split("/").filter(Boolean);
    nodes.push({
      data: {
        id: path,
        label: info.title ?? info.source_name,
        parentDir: segs.slice(-3, -1).join("/") || segs[0] || "",
        kind: "note",
      },
    });
  }

  // 4) Tag 노드 추가
  if (tagIndex && (mode === "tags" || mode === "both")) {
    for (const tagNodeId of tagNodeIds) {
      const tagKey = tagNodeId.slice("tag:".length);
      const display = tagIndex.display.get(tagKey) ?? tagKey;
      nodes.push({
        data: {
          id: tagNodeId,
          label: `#${display}`,
          kind: "tag",
          tagKey,
        },
      });
    }
  }

  return { nodes, edges, isolatedCount };
}

/**
 * 현재 노트로부터 1-hop 이웃(아웃·인 모두) path 집합.
 */
export function getNeighbors(currentPath: string, index: LinkIndex): Set<string> {
  const neighbors = new Set<string>();

  // outgoing
  const info = index.byPath.get(currentPath);
  if (info) {
    for (const raw of info.targets) {
      const name = targetName(raw);
      const t = resolveTarget(name, index);
      if (t && t !== currentPath) neighbors.add(t);
    }
  }
  // incoming (backlinks)
  const sources = index.backlinks.get(currentPath);
  if (sources) {
    for (const s of sources) {
      if (s !== currentPath) neighbors.add(s);
    }
  }
  return neighbors;
}
