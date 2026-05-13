import type { LinkIndex } from "$lib/linkIndex";
import { resolveTarget, targetName } from "$lib/linkIndex";
import type { TagIndex } from "$lib/stores/tags";
import type { MemoryLink } from "$lib/tauri/mirror";

export type GraphMode = "links" | "tags" | "both";

export interface GraphElement {
  data: {
    id: string;
    source?: string;
    target?: string;
    label?: string;
    parentDir?: string;
    kind?: "note" | "tag" | "memory";
    edgeKind?: "link" | "tag" | "related" | "memory-link";
    tagKey?: string;
    /** kind="memory" 전용 — 메모리 노드 클릭 시 vault `_memories/**` lookup에 사용 */
    sourceId?: number;
    /** kind="memory" 전용 — "summary" | "observation" */
    memoryKind?: "summary" | "observation";
    /** kind="memory" 전용 — match_role 라벨 (UI 디버깅용) */
    matchRole?: string;
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
  /** Phase C.4 — 메모리 노드 + 엣지 포함 여부. 기본 false. */
  showMemory?: boolean;
  /** Phase C.4 — `mirrorListMemoryLinks` 결과. showMemory=true일 때만 사용. */
  memoryLinks?: MemoryLink[];
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
  const showMemory = options?.showMemory ?? false;
  const memoryLinks = options?.memoryLinks ?? [];

  const edges: GraphElement[] = [];
  const edgeKeys = new Set<string>();
  const connected = new Set<string>();
  const tagNodeIds = new Set<string>();
  const memoryNodeMap = new Map<
    string,
    { sourceId: number; memoryKind: "summary" | "observation"; title: string }
  >();

  // 1) Link 엣지 (links / both 모드) — wikilink + md link 통합
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

      // 1b) Related 엣지 — SharedDocs 4키 스키마 §2.4의 cross-ref
      // related는 stem 배열이므로 linkIndex의 stem resolver로 해결.
      for (const stem of info.related) {
        const targetPath = resolveTarget(stem, index);
        if (!targetPath || targetPath === path) continue;
        const key = `related|${path}|${targetPath}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push({
          data: {
            id: `re:${edges.length}`,
            source: path,
            target: targetPath,
            edgeKind: "related",
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

  // 3') Memory 엣지 + 노드 (Phase C.4) — 노트(linkIndex)에 있는 vault_note_path만 매칭
  if (showMemory) {
    for (const link of memoryLinks) {
      const notePath = link.vault_note_path;
      if (!index.byPath.has(notePath)) continue; // 인덱스에 없는 경로는 skip (stale 또는 외부)
      const memoryId = `mem:${link.type}:${link.source_id}`;
      const key = `mem|${notePath}|${memoryId}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({
        data: {
          id: `me:${edges.length}`,
          source: memoryId,
          target: notePath,
          edgeKind: "memory-link",
          matchRole: link.match_role,
        },
      });
      connected.add(notePath);
      connected.add(memoryId);
      memoryNodeMap.set(memoryId, {
        sourceId: link.source_id,
        memoryKind: link.type,
        title: link.title,
      });
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

  // 5) Memory 노드 (Phase C.4)
  for (const [memoryId, meta] of memoryNodeMap) {
    nodes.push({
      data: {
        id: memoryId,
        label: meta.title,
        kind: "memory",
        memoryKind: meta.memoryKind,
        sourceId: meta.sourceId,
      },
    });
  }

  return { nodes, edges, isolatedCount };
}

/**
 * 현재 노트로부터 1-hop 이웃(아웃·인 모두) path 집합.
 * link(`[[]]`, `[](.md)`)와 related(frontmatter cross-ref) 모두 포함.
 */
export function getNeighbors(currentPath: string, index: LinkIndex): Set<string> {
  const neighbors = new Set<string>();

  const info = index.byPath.get(currentPath);
  if (info) {
    // outgoing — wikilink/md link
    for (const raw of info.targets) {
      const name = targetName(raw);
      const t = resolveTarget(name, index);
      if (t && t !== currentPath) neighbors.add(t);
    }
    // outgoing — related
    for (const stem of info.related) {
      const t = resolveTarget(stem, index);
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
