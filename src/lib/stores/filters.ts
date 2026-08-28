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

/**
 * 폴더 축 — **경로 접두사** 집합.
 *
 * ⚠️ 2026-08-28 실측: 이 vault 는 한 안에 프로젝트가 둘이고 이름 충돌 7건이 **전부**
 * 그 사이에서 났다. 두 프로젝트가 **같은 `doc_kind` 를 쓰므로** 기존 두 축으로는 경계를
 * 못 긋는다.
 *
 * ⚠️ 값은 문자열 접두사다 — MCP `under`·`exclude` 와 **같은 규칙**이어야 한다
 * (`folderScope.ts` 참조). 앱만 디렉터리 경계로 맞추면 같은 문자열이 표면마다 다르게 먹는다.
 */
export const selectedFolders = writable<Set<string>>(new Set());

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

export function toggleFolder(prefix: string): void {
  selectedFolders.update((set) => {
    const next = new Set(set);
    if (next.has(prefix)) next.delete(prefix);
    else next.add(prefix);
    return next;
  });
}

export function clearFilters(): void {
  selectedDocKinds.set(new Set());
  selectedTopics.set(new Set());
  selectedFolders.set(new Set());
}

export function clearFacetCounts(): void {
  docKindCounts.set(new Map());
  topicCounts.set(new Map());
}

/**
 * 선택된 facet에 매칭되는 노트만 골라 반환.
 * - 다중 선택 시 같은 축 안에서는 OR (예: doc_kind in {plan, spec})
 * - 다른 축 사이에는 AND (예: doc_kind=plan AND topic=event-bubble AND 폴더=lapis)
 *
 * ⚠️ **셋 다 비어 있으면 빈 배열**이다(선택 안 했을 때 결과를 안 보여준다). 축을 더하면서
 * 이 규칙을 안 늘리면 폴더만 골랐을 때 조용히 아무것도 안 나온다.
 */
export function applyFilters(
  infos: Iterable<LinkInfo>,
  docKinds: Set<string>,
  topics: Set<string>,
  folders: Set<string> = new Set(),
): LinkInfo[] {
  if (docKinds.size === 0 && topics.size === 0 && folders.size === 0) return [];
  const out: LinkInfo[] = [];
  for (const info of infos) {
    if (docKinds.size > 0) {
      if (!info.doc_kind || !docKinds.has(info.doc_kind)) continue;
    }
    if (topics.size > 0) {
      if (!info.topic || !topics.has(info.topic)) continue;
    }
    // ⚠️ 문자열 접두사 — `folderScope.ts` 의 `inScope` 와 같은 규칙.
    if (folders.size > 0) {
      let hit = false;
      for (const f of folders) {
        if (info.source_path.startsWith(f)) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
    }
    out.push(info);
  }
  return out;
}
