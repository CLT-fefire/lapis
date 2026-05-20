import { writable, get } from "svelte/store";
import {
  buildQuickEntries,
  workerAddAll,
  workerReset,
  type QuickEntry,
} from "$lib/searchIndex";
import type { LinkInfo, NoteContent } from "$lib/tauri/notes";

/**
 * 검색 인덱스 store. 모달 open/mode 상태는 Phase 4.5에서 `stores/palette.ts`로 이관.
 * 여기엔 vault.ts가 빌드·갱신하는 인덱스만 남긴다.
 *
 * **본 chore부터 풀텍스트 인덱스는 Web Worker에 보관** — main thread freeze 0. store는
 * "worker가 검색 가능한 상태인가" boolean(`fullTextIndexReady`)만 노출. 검색은
 * `workerSearch`를 통해 worker에 위임.
 */

export const quickEntries = writable<QuickEntry[]>([]);
/**
 * worker 안 MiniSearch 인덱스가 검색 가능한 상태(loadJSON 또는 addAll 완료).
 * `false`면 검색 결과 빈 + UI에 "빌드 중" 표시.
 */
export const fullTextIndexReady = writable<boolean>(false);
export const indexBuilding = writable<boolean>(false);

/**
 * cache hit 시 cold-start measurement 안에서 `MiniSearch.loadJSON`(sync ~4.5s)을
 * 호출하지 않고, "이 vault path에 대한 minisearch_json을 idle 시점에 받아서 로드한다"는
 * pending 상태만 보관. 값이 있으면 = lazy load 대기 중.
 *
 * cold-start cacheLookup에선 메타(`read_search_cache_meta`)만 받고, 본 store에 vault path를
 * 박은 뒤 `requestIdleCallback` 시점에 `read_search_cache_minisearch_json`을 호출 → 30MB
 * IPC + worker.loadJSON은 그때서야 발생.
 */
export const pendingFullTextVault = writable<string | null>(null);

/** worker가 loadJSON / addAll 중일 때 true. UI에 "빌드 중" 표시용. */
export const fullTextLoading = writable<boolean>(false);

/**
 * vault 로딩 시 호출 — cache miss 풀 빌드 경로. worker에 addAll 위임.
 *
 * 5.1.d 변경(이전): queueMicrotask + sync addAll → async + chunked yield.
 * **본 chore 변경**: worker로 addAll 위임 → main thread freeze 0. 단, worker로 docs를
 * postMessage하므로 structured clone 비용 발생(~수백 ms). 그래도 main thread에서 9s sync
 * addAll보다 압도적으로 가벼움.
 */
export async function rebuildIndexes(
  linkInfos: LinkInfo[],
  contents: NoteContent[],
): Promise<void> {
  quickEntries.set(buildQuickEntries(linkInfos));
  indexBuilding.set(true);
  fullTextIndexReady.set(false);
  try {
    const docs = contents.map((n) => ({ id: n.path, name: n.name, body: n.body }));
    await workerAddAll(docs);
    fullTextIndexReady.set(true);
  } catch (e) {
    console.error("worker addAll failed", e);
    fullTextIndexReady.set(false);
  } finally {
    indexBuilding.set(false);
  }
}

export function clearIndexes(): void {
  quickEntries.set([]);
  fullTextIndexReady.set(false);
  indexBuilding.set(false);
  // worker의 in-memory 인덱스도 release — 다음 빌드 전까지 메모리 줄임.
  void workerReset().catch((e) => console.warn("worker reset failed", e));
}

/** 디버그/상태 확인용 — worker 모델이라 doc count는 worker 안에 있음. ready boolean만. */
export function indexStats() {
  return {
    quick: get(quickEntries).length,
    fullTextReady: get(fullTextIndexReady),
  };
}
