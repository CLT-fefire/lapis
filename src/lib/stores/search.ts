import { writable, get } from "svelte/store";
import {
  buildQuickEntries,
  workerAddToShard,
  workerReset,
  computeShardId,
  decideShardCount,
  type QuickEntry,
  type FullTextDoc,
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
 * cache hit 시 lazy load 대기 정보. cold-start cacheLookup에서 meta만 받고 본 store에
 * vault path + shard_count를 박은 뒤, idle 시점에 shard 0..N 순차 로드.
 *
 * - null: lazy 대기 없음 (이미 로드됨 또는 vault 없음)
 * - {vault, shardCount}: 그 vault의 N개 shard를 idle 시점에 로드
 */
export const pendingFullTextVault = writable<{
  vault: string;
  shardCount: number;
} | null>(null);

/** worker가 loadJSON / addAll 중일 때 true. UI에 "빌드 중" 표시용. */
export const fullTextLoading = writable<boolean>(false);

/**
 * 풀텍스트 풀 빌드(cache-miss `rebuildIndexes`) 진행률 — 인덱싱된 doc 수 / 전체.
 * MemorySyncModal "인덱스 갱신 중" 단계에서 퍼센트+막대 표시. 빌드 외엔 null.
 */
export const buildProgress = writable<{ done: number; total: number } | null>(null);

/**
 * vault 로딩 시 호출 — cache miss 풀 빌드 경로. **sharded(동적)**: vault 크기 기반
 * shard 수 결정 후 분할 + 순차 worker addAll.
 *
 * - shard 수 = `decideShardCount(contents.length)`. 사용자 vault 11933 → 4 shard.
 *   매우 큰 vault(50000+) → 16 shard로 첫 shard ready 더 빠름.
 * - 첫 shard 완료 시점에 `fullTextIndexReady=true` set → 사용자 부분 검색 가능
 * - 모든 shard 완료 후 caller(vault.ts)가 캐시 저장 트리거 — meta에 shard_count 박제
 *
 * @returns 결정된 shard 수 (caller가 cache 저장 시 사용)
 */
export async function rebuildIndexes(
  linkInfos: LinkInfo[],
  contents: NoteContent[],
): Promise<number> {
  quickEntries.set(buildQuickEntries(linkInfos));
  indexBuilding.set(true);
  fullTextIndexReady.set(false);
  const shardCount = decideShardCount(contents.length);
  buildProgress.set({ done: 0, total: contents.length });
  let done = 0;
  try {
    if (import.meta.env.DEV) {
      console.debug(
        `[lapis-perf] rebuildIndexes shardCount=${shardCount} notes=${contents.length}`,
      );
    }
    // shard별로 분할 — fnv32(path) % shardCount 결정론
    const shards: FullTextDoc[][] = Array.from({ length: shardCount }, () => []);
    for (const n of contents) {
      const s = computeShardId(n.path, shardCount);
      shards[s].push({ id: n.path, name: n.name, body: n.body });
    }
    // 순차 빌드. 각 shard를 작은 배치로 나눠 worker에 전송 — 한 shard 전체(수천 doc ×
    // body)를 한 번에 postMessage하면 WKWebView가 main thread structured clone에 수 초를
    // 써 UI(인덱스 빌드 스피너)가 freeze된다. 배치마다 await(worker 왕복)로 main thread가
    // 양보돼 스피너가 계속 돈다. 첫 shard 완료 시 partial ready set.
    const POST_BATCH = 500;
    for (let i = 0; i < shardCount; i++) {
      const t0 = import.meta.env.DEV ? performance.now() : 0;
      const docs = shards[i];
      // 첫 배치는 reset=true(새 인덱스). 빈 shard도 reset 1회로 초기화.
      await workerAddToShard(i, docs.slice(0, POST_BATCH), true);
      done += Math.min(POST_BATCH, docs.length);
      buildProgress.set({ done, total: contents.length });
      for (let off = POST_BATCH; off < docs.length; off += POST_BATCH) {
        await workerAddToShard(i, docs.slice(off, off + POST_BATCH), false);
        done += Math.min(POST_BATCH, docs.length - off);
        buildProgress.set({ done, total: contents.length });
      }
      if (i === 0) fullTextIndexReady.set(true);
      if (import.meta.env.DEV) {
        const dt = performance.now() - t0;
        console.debug(
          `[lapis-perf] worker.shard${i} build docs=${docs.length} dt=${dt.toFixed(0)}ms`,
        );
      }
    }
  } catch (e) {
    console.error("worker shard addAll failed", e);
    fullTextIndexReady.set(false);
  } finally {
    indexBuilding.set(false);
    buildProgress.set(null);
  }
  return shardCount;
}

export function clearIndexes(): void {
  quickEntries.set([]);
  fullTextIndexReady.set(false);
  indexBuilding.set(false);
  buildProgress.set(null);
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
