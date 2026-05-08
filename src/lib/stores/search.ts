import { writable, get } from "svelte/store";
import type MiniSearch from "minisearch";
import {
  buildQuickEntries,
  buildFullTextIndex,
  type QuickEntry,
  type FullTextDoc,
} from "$lib/searchIndex";
import type { LinkInfo, NoteContent } from "$lib/tauri/notes";

export type SearchMode = "files" | "fulltext";

export const searchOpen = writable<boolean>(false);
export const searchMode = writable<SearchMode>("files");

export const quickEntries = writable<QuickEntry[]>([]);
export const fullTextIndex = writable<MiniSearch<FullTextDoc> | null>(null);
export const indexBuilding = writable<boolean>(false);

export function openSearch(mode: SearchMode): void {
  searchMode.set(mode);
  searchOpen.set(true);
}

export function closeSearch(): void {
  searchOpen.set(false);
}

export function toggleSearchMode(): void {
  searchMode.update((m) => (m === "files" ? "fulltext" : "files"));
}

/** vault 로딩 시 호출. 두 인덱스를 모두 빌드. 백그라운드 실행. */
export function rebuildIndexes(linkInfos: LinkInfo[], contents: NoteContent[]): void {
  quickEntries.set(buildQuickEntries(linkInfos));
  indexBuilding.set(true);
  // 큰 vault에서 동기 빌드도 1초 미만이지만 UI 차단 막으려고 마이크로태스크 양보
  queueMicrotask(() => {
    try {
      fullTextIndex.set(buildFullTextIndex(contents));
    } catch (e) {
      console.error("buildFullTextIndex failed", e);
      fullTextIndex.set(null);
    } finally {
      indexBuilding.set(false);
    }
  });
}

export function clearIndexes(): void {
  quickEntries.set([]);
  fullTextIndex.set(null);
  indexBuilding.set(false);
}

/** 디버그/상태 확인용 */
export function indexStats() {
  return {
    quick: get(quickEntries).length,
    fullText: get(fullTextIndex)?.documentCount ?? 0,
  };
}
