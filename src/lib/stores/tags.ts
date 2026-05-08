import { writable } from "svelte/store";
import type { LinkInfo } from "$lib/tauri/notes";

export interface TagIndex {
  byTag: Map<string, Set<string>>; // tag(소문자) → 노트 path 집합
  display: Map<string, string>;     // tag(소문자) → 표시용 원본 케이스 (가장 자주 쓰는 형태)
  counts: Map<string, number>;
  sortedTags: string[];             // count 내림차순 → 알파벳
}

export type SidebarTab = "files" | "tags";

export const tagIndex = writable<TagIndex | null>(null);
export const selectedTag = writable<string | null>(null); // 소문자 키
export const sidebarTab = writable<SidebarTab>("files");

export function buildTagIndex(infos: LinkInfo[]): TagIndex {
  const byTag = new Map<string, Set<string>>();
  const displayCount = new Map<string, Map<string, number>>();

  for (const info of infos) {
    for (const raw of info.tags) {
      const tag = raw.trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      let paths = byTag.get(key);
      if (!paths) {
        paths = new Set();
        byTag.set(key, paths);
      }
      paths.add(info.source_path);

      // 표시 케이스 카운팅 (같은 tag라도 #ChatRoom vs #chatroom 같은 케이스 차이)
      let casings = displayCount.get(key);
      if (!casings) {
        casings = new Map();
        displayCount.set(key, casings);
      }
      casings.set(tag, (casings.get(tag) ?? 0) + 1);
    }
  }

  const display = new Map<string, string>();
  for (const [key, casings] of displayCount) {
    let best = "";
    let bestCount = -1;
    for (const [casing, count] of casings) {
      if (count > bestCount) {
        best = casing;
        bestCount = count;
      }
    }
    display.set(key, best);
  }

  const counts = new Map<string, number>();
  for (const [key, paths] of byTag) counts.set(key, paths.size);

  const sortedTags = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);

  return { byTag, display, counts, sortedTags };
}

export function selectTag(tag: string | null): void {
  selectedTag.set(tag ? tag.toLowerCase() : null);
}

export function showTagsTab(): void {
  sidebarTab.set("tags");
}

export function showFilesTab(): void {
  sidebarTab.set("files");
}

export function clearTagIndex(): void {
  tagIndex.set(null);
  selectedTag.set(null);
}
