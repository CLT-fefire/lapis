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
 * **옵션·shard 모델·union 랭킹은 여기 없다** — `fullTextOptions.ts`가 단일 진실이다.
 * 이 파일은 그것을 worker 메시지 프로토콜로 감싸는 껍데기다.
 */

import type MiniSearch from "minisearch";
import MiniSearchCtor from "minisearch";
import {
  FULLTEXT_OPTIONS,
  MAX_SHARDS,
  unionRank,
  type FullTextDoc,
  type FullTextHit,
} from "./fullTextOptions";

const indexes: (MiniSearch<FullTextDoc> | null)[] = new Array(MAX_SHARDS).fill(null);

type WorkerHit = FullTextHit;

type InMsg =
  | { type: "loadShard"; id: number; shardId: number; jsonBytes: ArrayBuffer }
  | {
      type: "addToShard";
      id: number;
      shardId: number;
      docs: FullTextDoc[];
      /** true면 shard 인덱스를 새로 만든 뒤 추가(첫 배치). false면 기존에 append. */
      reset: boolean;
    }
  | { type: "toJSONShard"; id: number; shardId: number }
  | { type: "updateDoc"; id: number; shardId: number; doc: FullTextDoc }
  | { type: "removeDoc"; id: number; shardId: number; docId: string }
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
        indexes[msg.shardId] = MiniSearchCtor.loadJSON(
          json,
          FULLTEXT_OPTIONS,
        ) as MiniSearch<FullTextDoc>;
        post({ type: "ready", id: msg.id });
        break;
      }
      case "addToShard": {
        if (msg.shardId < 0 || msg.shardId >= MAX_SHARDS) {
          throw new Error(`invalid shardId=${msg.shardId}`);
        }
        // reset=true(첫 배치)면 새 인덱스, 아니면 기존에 append. main thread가 docs를
        // 작은 배치로 나눠 보내므로(cache-miss postMessage clone freeze 방지) 여기선
        // 받은 배치를 그대로 addAll. 배치가 작아 worker thread 블록도 짧음.
        if (msg.reset || !indexes[msg.shardId]) {
          indexes[msg.shardId] = new MiniSearchCtor<FullTextDoc>(FULLTEXT_OPTIONS);
        }
        if (msg.docs.length > 0) {
          indexes[msg.shardId]!.addAll(msg.docs);
        }
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
      case "updateDoc": {
        // 증분 갱신 — 단일 노트 add/replace (vault 전체 재빌드 회피).
        if (msg.shardId < 0 || msg.shardId >= MAX_SHARDS) {
          throw new Error(`invalid shardId=${msg.shardId}`);
        }
        let index = indexes[msg.shardId];
        if (!index) {
          index = new MiniSearchCtor<FullTextDoc>(FULLTEXT_OPTIONS);
          indexes[msg.shardId] = index;
        }
        if (index.has(msg.doc.id)) index.replace(msg.doc);
        else index.add(msg.doc);
        post({ type: "ready", id: msg.id });
        break;
      }
      case "removeDoc": {
        // 증분 삭제 — discard(lazy). 없으면 무시.
        if (msg.shardId < 0 || msg.shardId >= MAX_SHARDS) {
          throw new Error(`invalid shardId=${msg.shardId}`);
        }
        const index = indexes[msg.shardId];
        if (index && index.has(msg.docId)) index.discard(msg.docId);
        post({ type: "ready", id: msg.id });
        break;
      }
      case "search": {
        post({ type: "results", id: msg.id, hits: unionRank(indexes, msg.query, msg.limit) });
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
