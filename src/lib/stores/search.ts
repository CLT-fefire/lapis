import { writable, get } from "svelte/store";
import type MiniSearch from "minisearch";
import {
  buildQuickEntries,
  buildFullTextIndexChunked,
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

/**
 * cache hit 시 cold-start measurement 안에서 `MiniSearch.loadJSON`(sync ~4.5s)을
 * 호출하지 않고, 캐시된 JSON 문자열을 잠시 보관 → idle 시점에 백그라운드 빌드.
 *
 * - 값이 있으면 = fullTextIndex가 아직 빌드 중 (loadJSON 대기)
 * - 사용자가 검색을 시도할 때 fullTextIndex가 null + 본 store가 not-null이면 즉시 await
 */
export const pendingFullTextJson = writable<string | null>(null);

/** `MiniSearch.loadJSON`이 메인 thread를 점유하는 동안 true. UI에 "빌드 중" 표시용. */
export const fullTextLoading = writable<boolean>(false);

/**
 * vault 로딩 시 호출. 두 인덱스를 모두 빌드.
 *
 * 5.1.d 변경: queueMicrotask + sync addAll → async + chunked yield.
 * 큰 vault(10000+ 노트, 메모리 export 직후)에서 MiniSearch 빌드가 JS main thread를
 * 수 초간 점유 → 다른 앱 응답성 저하. CHUNK 단위로 yield하면 JS event loop가
 * OS/UI 메시지 처리 시간 확보.
 */
export async function rebuildIndexes(
  linkInfos: LinkInfo[],
  contents: NoteContent[],
): Promise<void> {
  quickEntries.set(buildQuickEntries(linkInfos));
  indexBuilding.set(true);
  try {
    const idx = await buildFullTextIndexChunked(contents);
    fullTextIndex.set(idx);
  } catch (e) {
    console.error("buildFullTextIndex failed", e);
    fullTextIndex.set(null);
  } finally {
    indexBuilding.set(false);
  }
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
