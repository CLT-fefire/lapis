/// <reference lib="webworker" />
/**
 * MiniSearch 풀텍스트 인덱스 Web Worker — sharded progressive load.
 *
 * **v4 변경**: 단일 인스턴스 → N개 shard array(`indexes: MiniSearch[]`).
 * - 각 shard 별도 loadJSON / addAll / toJSON 가능 → 점진 로드
 * - search는 ready된 모든 shard에 query + score union → top-N
 * - 첫 shard 로드 시점에 부분 검색 가능 (사용자 perceived 단축)
 *
 * **메시지**:
 * - main → worker:
 *   - `{type:"loadShard", id, shardId, jsonBytes}` — 캐시 hit lazy 시점
 *   - `{type:"addAllShard", id, shardId, docs, chunkSize?}` — cache miss 풀 빌드
 *   - `{type:"toJSONShard", id, shardId}` — 캐시 저장 직전
 *   - `{type:"search", id, query, limit}` — 모든 ready shard union
 *   - `{type:"resetAll", id}` — vault 전환 등으로 모든 shard 비우기
 * - worker → main:
 *   - `{type:"ready", id}` — load/addAll/reset 완료
 *   - `{type:"results", id, hits}` — search 결과
 *   - `{type:"json", id, jsonBytes}` — toJSON 결과 (transferable)
 *   - `{type:"error", id, error}`
 *
 * **transferable**: jsonBytes는 ArrayBuffer. WKWebView postMessage 30MB string clone
 * (~32s)을 zero-copy(ms)로 압축. PR #53 학습.
 *
 * **shard 결정론**: `shardId = fnv32(doc.path) % MAX_SHARDS`. main thread도 같은 함수
 * 사용 (`searchIndex.ts:computeShardId`).
 *
 * **제약**: worker는 Tauri invoke 불가. snippet 생성은 main thread에서 `readNote` 사용.
 *
 * **옵션 일관**: `FULLTEXT_OPTIONS`는 `searchIndex.ts`와 동일. 옵션 변경 시 두 곳 + CACHE_VERSION bump.
 */

import MiniSearch, { type Options } from "minisearch";

interface FullTextDoc {
  id: string;
  name: string;
  body: string;
}

const FULLTEXT_OPTIONS: Options<FullTextDoc> = {
  fields: ["name", "body"],
  storeFields: ["name"],
  idField: "id",
  searchOptions: {
    boost: { name: 3 },
    prefix: true,
    fuzzy: 0.15,
  },
};

/**
 * 최대 shard 수 — main과 일치(`searchIndex.ts:MAX_SHARDS`). 실제 사용 shard 수는
 * vault별로 다름(`decideShardCount`로 main 결정). worker는 max 길이 배열을 미리
 * 할당해두고 사용하지 않는 shardId는 `null`로 유지. 메모리 영향 없음(null 16개).
 *
 * search 시 모든 인덱스 순회 — null은 자동 skip.
 */
const MAX_SHARDS = 16;
const indexes: (MiniSearch<FullTextDoc> | null)[] = new Array(MAX_SHARDS).fill(null);

interface WorkerHit {
  path: string;
  score: number;
  name: string;
}

type InMsg =
  | { type: "loadShard"; id: number; shardId: number; jsonBytes: ArrayBuffer }
  | {
      type: "addAllShard";
      id: number;
      shardId: number;
      docs: FullTextDoc[];
      chunkSize?: number;
    }
  | { type: "toJSONShard"; id: number; shardId: number }
  | { type: "search"; id: number; query: string; limit: number }
  | { type: "resetAll"; id: number };

type OutMsg =
  | { type: "ready"; id: number }
  | { type: "results"; id: number; hits: WorkerHit[] }
  | { type: "json"; id: number; jsonBytes: ArrayBuffer | null }
  | { type: "error"; id: number; error: string };

function post(msg: OutMsg, transfer?: Transferable[]): void {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
}

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "loadShard": {
        if (msg.shardId < 0 || msg.shardId >= MAX_SHARDS) {
          throw new Error(`invalid shardId=${msg.shardId}`);
        }
        const json = textDecoder.decode(new Uint8Array(msg.jsonBytes));
        indexes[msg.shardId] = MiniSearch.loadJSON(
          json,
          FULLTEXT_OPTIONS,
        ) as MiniSearch<FullTextDoc>;
        post({ type: "ready", id: msg.id });
        break;
      }
      case "addAllShard": {
        if (msg.shardId < 0 || msg.shardId >= MAX_SHARDS) {
          throw new Error(`invalid shardId=${msg.shardId}`);
        }
        const newIndex = new MiniSearch<FullTextDoc>(FULLTEXT_OPTIONS);
        const chunkSize = msg.chunkSize ?? 200;
        for (let i = 0; i < msg.docs.length; i += chunkSize) {
          const chunk = msg.docs.slice(i, i + chunkSize);
          newIndex.addAll(chunk);
          if (i + chunkSize < msg.docs.length) {
            await new Promise<void>((r) => setTimeout(r, 0));
          }
        }
        indexes[msg.shardId] = newIndex;
        post({ type: "ready", id: msg.id });
        break;
      }
      case "toJSONShard": {
        if (msg.shardId < 0 || msg.shardId >= MAX_SHARDS) {
          throw new Error(`invalid shardId=${msg.shardId}`);
        }
        const idx = indexes[msg.shardId];
        if (!idx) {
          post({ type: "json", id: msg.id, jsonBytes: null });
          break;
        }
        const jsonStr = JSON.stringify(idx);
        const bytes = textEncoder.encode(jsonStr);
        post({ type: "json", id: msg.id, jsonBytes: bytes.buffer }, [bytes.buffer]);
        break;
      }
      case "search": {
        // 모든 ready shard에 query → union → score 내림차순 → top-N
        // 각 shard 결과는 `{id, score, ...storeFields}` (MiniSearch SearchResult).
        const combined: { path: string; score: number; name: string }[] = [];
        for (const idx of indexes) {
          if (!idx) continue;
          const results = idx.search(msg.query);
          for (const r of results) {
            combined.push({
              path: r.id as string,
              score: r.score,
              name: (r as unknown as { name: string }).name,
            });
          }
        }
        combined.sort((a, b) => b.score - a.score);
        const hits: WorkerHit[] = combined.slice(0, msg.limit);
        post({ type: "results", id: msg.id, hits });
        break;
      }
      case "resetAll": {
        for (let i = 0; i < MAX_SHARDS; i++) indexes[i] = null;
        post({ type: "ready", id: msg.id });
        break;
      }
    }
  } catch (err) {
    post({
      type: "error",
      id: msg.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
