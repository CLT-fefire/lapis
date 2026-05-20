/// <reference lib="webworker" />
/**
 * MiniSearch 풀텍스트 인덱스 Web Worker.
 *
 * **왜 worker**: `MiniSearch.loadJSON`(11924 doc, sync ~4.5s) + `addAll`(sync ~9s)이
 * main thread를 점유. PR #52에서 lazy idle callback으로 cold-start measurement는
 * 분리했지만, idle 시점에 4.5s freeze가 여전히 발생. 본 worker는 별 thread에서
 * 인덱스 보유 + 검색 처리 → main thread freeze 0.
 *
 * **흐름**:
 * - main → worker: `{type:"loadJSON", id, json}` (cache hit lazy 시점에 30MB JSON)
 * - main → worker: `{type:"addAll", id, docs}` (cache miss 풀 빌드 시점에 doc 배열)
 * - main → worker: `{type:"search", id, query, limit}`
 * - main → worker: `{type:"toJSON", id}` (캐시 저장 직전)
 * - worker → main: `{type:"ready", id}` / `{type:"results", id, hits}` /
 *                   `{type:"json", id, json}` / `{type:"error", id, error}`
 *
 * msgId 기반 응답 매칭 — 빠른 타이핑 시 stale 응답 무시 가능.
 *
 * **제약**: worker는 Tauri invoke 불가. snippet 생성은 main thread에서 `readNote` 사용.
 * worker는 검색 결과로 `{path, score, name}`만 반환 → main에서 snippet 합성.
 *
 * **옵션 일관**: `FULLTEXT_OPTIONS`는 `searchIndex.ts`와 동일해야. 본 파일에 복제 — module
 * 격리 trade-off. 옵션 변경 시 두 곳 다 + `search_cache.rs:CACHE_VERSION` bump 필수.
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

let index: MiniSearch<FullTextDoc> | null = null;

interface WorkerHit {
  path: string;
  score: number;
  name: string;
}

type InMsg =
  | { type: "loadJSON"; id: number; jsonBytes: ArrayBuffer }
  | { type: "addAll"; id: number; docs: FullTextDoc[]; chunkSize?: number }
  | { type: "search"; id: number; query: string; limit: number }
  | { type: "toJSON"; id: number }
  | { type: "reset"; id: number };

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
      case "loadJSON": {
        // transferable ArrayBuffer — zero-copy 전송. 30MB string clone(WebKit에서
        // 매우 느림, 32s 측정 사례)을 피한다.
        const json = textDecoder.decode(new Uint8Array(msg.jsonBytes));
        index = MiniSearch.loadJSON(json, FULLTEXT_OPTIONS) as MiniSearch<FullTextDoc>;
        post({ type: "ready", id: msg.id });
        break;
      }
      case "addAll": {
        const newIndex = new MiniSearch<FullTextDoc>(FULLTEXT_OPTIONS);
        const chunkSize = msg.chunkSize ?? 200;
        // worker 안에서 chunked + setTimeout(0) yield. worker에선 main thread가
        // 아니지만 같은 thread 안 다른 메시지(search 등) 처리를 위해 chunk 사이 양보.
        for (let i = 0; i < msg.docs.length; i += chunkSize) {
          const chunk = msg.docs.slice(i, i + chunkSize);
          newIndex.addAll(chunk);
          if (i + chunkSize < msg.docs.length) {
            await new Promise<void>((r) => setTimeout(r, 0));
          }
        }
        index = newIndex;
        post({ type: "ready", id: msg.id });
        break;
      }
      case "search": {
        if (!index) {
          post({ type: "results", id: msg.id, hits: [] });
          break;
        }
        const results = index.search(msg.query);
        const hits: WorkerHit[] = results.slice(0, msg.limit).map((r) => ({
          path: r.id as string,
          score: r.score,
          name: (r as unknown as { name: string }).name,
        }));
        post({ type: "results", id: msg.id, hits });
        break;
      }
      case "toJSON": {
        if (!index) {
          post({ type: "json", id: msg.id, jsonBytes: null });
          break;
        }
        // JSON 직렬화는 worker 안에서 (main thread freeze 0).
        // 결과는 ArrayBuffer로 transferable — main thread clone 비용 0.
        const jsonStr = JSON.stringify(index);
        const bytes = textEncoder.encode(jsonStr);
        post({ type: "json", id: msg.id, jsonBytes: bytes.buffer }, [bytes.buffer]);
        break;
      }
      case "reset": {
        index = null;
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
