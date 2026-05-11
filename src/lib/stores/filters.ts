import { writable } from "svelte/store";
import type { LinkInfo } from "$lib/tauri/notes";

/**
 * doc_kind / topic facet 필터 — 다중 선택 (AND 조건).
 * SharedDocs Markdown-Tag-Management-Guide.md §2.1, §2.2 기반.
 */

export const DOC_KIND_ENUM: readonly string[] = [
  "requirements",
  "spec",
  "plan",
  "solution",
  "analysis",
  "brainstorm",
  "howto",
  "reference",
  "meeting-notes",
];

/** kind/topic → 노트 수 (count > 0인 것만 포함) */
export const docKindCounts = writable<Map<string, number>>(new Map());
export const topicCounts = writable<Map<string, number>>(new Map());

/** 선택된 facet 값들 (다중 선택, AND) */
export const selectedDocKinds = writable<Set<string>>(new Set());
export const selectedTopics = writable<Set<string>>(new Set());

export interface FacetCounts {
  docKindCounts: Map<string, number>;
  topicCounts: Map<string, number>;
}

export function buildFacetCounts(infos: LinkInfo[]): FacetCounts {
  const dk = new Map<string, number>();
  const tp = new Map<string, number>();
  for (const info of infos) {
    if (info.doc_kind) {
      dk.set(info.doc_kind, (dk.get(info.doc_kind) ?? 0) + 1);
    }
    if (info.topic) {
      tp.set(info.topic, (tp.get(info.topic) ?? 0) + 1);
    }
  }
  return { docKindCounts: dk, topicCounts: tp };
}

export function toggleDocKind(value: string): void {
  selectedDocKinds.update((set) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  });
}

export function toggleTopic(value: string): void {
  selectedTopics.update((set) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  });
}

export function clearFilters(): void {
  selectedDocKinds.set(new Set());
  selectedTopics.set(new Set());
}

export function clearFacetCounts(): void {
  docKindCounts.set(new Map());
  topicCounts.set(new Map());
}

/**
 * 선택된 facet에 매칭되는 노트만 골라 반환.
 * - 다중 선택 시 같은 facet 내에서는 OR (예: doc_kind in {plan, spec})
 * - 다른 facet 간에는 AND (예: doc_kind=plan AND topic=event-bubble)
 * 양쪽 모두 비어 있으면 빈 배열 반환 (선택 안 했을 때 결과 안 보여줌).
 */
export function applyFilters(
  infos: Iterable<LinkInfo>,
  docKinds: Set<string>,
  topics: Set<string>,
): LinkInfo[] {
  if (docKinds.size === 0 && topics.size === 0) return [];
  const out: LinkInfo[] = [];
  for (const info of infos) {
    if (docKinds.size > 0) {
      if (!info.doc_kind || !docKinds.has(info.doc_kind)) continue;
    }
    if (topics.size > 0) {
      if (!info.topic || !topics.has(info.topic)) continue;
    }
    out.push(info);
  }
  return out;
}
