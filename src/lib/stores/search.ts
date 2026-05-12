import { writable, get } from "svelte/store";
import type MiniSearch from "minisearch";
import {
  buildQuickEntries,
  buildFullTextIndex,
  type QuickEntry,
  type FullTextDoc,
} from "$lib/searchIndex";
import type { LinkInfo, NoteContent } from "$lib/tauri/notes";

/**
 * 검색 인덱스 store. 모달 open/mode 상태는 Phase 4.5에서 `stores/palette.ts`로 이관.
 * 여기엔 vault.ts가 빌드·갱신하는 인덱스만 남긴다.
 */

export const quickEntries = writable<QuickEntry[]>([]);
export const fullTextIndex = writable<MiniSearch<FullTextDoc> | null>(null);
export const indexBuilding = writable<boolean>(false);

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
