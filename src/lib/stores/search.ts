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
import type { FileStat, LinkInfo, NoteContent } from "$lib/tauri/notes";
import { logError, logWarn } from "$lib/stores/usage";

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
 * - {vault, shardCount, fingerprint}: 그 vault의 N개 shard를 idle 시점에 로드
 *
 * `fingerprint`는 meta의 것 — shard를 읽을 때 대조해 **meta와 다른 스냅샷의 shard**를
 * 걸러낸다(`search_cache.rs` v7의 skew 검출).
 */
/**
 * 기동 델타 재조정 — shard를 옛 스냅샷에서 로드한 **직후** 적용할 패치.
 *
 * 디스크의 shard는 이전 fingerprint의 것이라 그대로 쓰면 바뀐 노트의 본문이 낡는다.
 * 로드 → 패치 → `fingerprint`로 캐시 재커밋까지가 한 단위다.
 *
 * ⚠️ 패치가 있으면 shard0 완료 시점에 `fullTextIndexReady`를 **세우지 않는다**.
 * 그 창(≈1.4s) 동안 검색이 바뀐 노트의 옛 본문을 낸다 — "검색했는데 안 나온다"보다
 * "검색했는데 틀린 게 나온다"가 나쁘다. progressive는 여기서만 포기한다.
 */
export interface FullTextPatch {
  /** 패치 적용 후의 fingerprint. 이 값으로 캐시를 다시 커밋한다. */
  fingerprint: string;
  /** 같은 walk에서 나온 stat 목록 — 다음 기동의 델타 근거. */
  fileStats: FileStat[];
  changed: string[];
  removed: string[];
}

export interface PendingFullText {
  vault: string;
  shardCount: number;
  /** **디스크 shard의** fingerprint. 델타 경로에서는 이게 옛 스냅샷의 값이다. */
  fingerprint: string;
  patch?: FullTextPatch;
}

export const pendingFullTextVault = writable<PendingFullText | null>(null);

/** worker가 loadJSON / addAll 중일 때 true. UI에 "빌드 중" 표시용. */
export const fullTextLoading = writable<boolean>(false);

/**
 * 풀텍스트 풀 빌드(cache-miss `rebuildIndexes`) 진행률 — 인덱싱된 doc 수 / 전체.
 * 인덱스 빌드 오버레이에서 퍼센트+막대 표시. 빌드 외엔 null.
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
  // frontmatter title은 `NoteContent`(Rust 번들의 본문 쪽)에 없고 `LinkInfo`에 있다.
  // 둘 다 이미 여기 와 있으므로 경로로 잇는다 — Rust 번들 모양을 바꿀 이유가 없다.
  const titleByPath = new Map(linkInfos.map((i) => [i.source_path, i.title ?? ""]));
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
      shards[s].push({
        id: n.path,
        name: n.name,
        title: titleByPath.get(n.path) ?? "",
        body: n.body,
      });
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
    logError("stores/search", "worker shard addAll failed", e);
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
  void workerReset().catch((e) => logWarn("stores/search", "worker reset failed", e));
}

/** 디버그/상태 확인용 — worker 모델이라 doc count는 worker 안에 있음. ready boolean만. */
export function indexStats() {
  return {
    quick: get(quickEntries).length,
    fullTextReady: get(fullTextIndexReady),
  };
}
