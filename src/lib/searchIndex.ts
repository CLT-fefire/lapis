import type { NoteContent, LinkInfo } from "$lib/tauri/notes";
import { readNote } from "$lib/tauri/notes";
import { extractSnippetAround } from "$lib/snippet";
import FullTextWorker from "./fullTextWorker?worker";

/* =========================================================
 * Quick Switcher (파일명 / alias / title fuzzy 매칭)
 * MiniSearch 없이 직접 구현 — 가벼움, 빠름
 * ========================================================= */

export interface QuickEntry {
  path: string;
  primaryLabel: string;   // 표시용 (title || name)
  matchKeys: string[];    // 매칭 대상 (name, aliases, title 모두)
  parentPath: string;     // 부모 디렉토리 (UI 보조 표시용)
}

export interface QuickHit {
  entry: QuickEntry;
  matchedKey: string;
  score: number;
}

export function buildQuickEntries(infos: LinkInfo[]): QuickEntry[] {
  return infos.map((info) => {
    const keys = new Set<string>();
    keys.add(info.source_name);
    if (info.title) keys.add(info.title);
    for (const a of info.aliases) keys.add(a);
    const segs = info.source_path.split("/").filter(Boolean);
    const parent = segs.slice(-3, -1).join("/"); // 부모 두 단계만
    return {
      path: info.source_path,
      primaryLabel: info.title ?? info.source_name,
      matchKeys: [...keys],
      parentPath: parent,
    };
  });
}

/**
 * 단순 fuzzy: subsequence 매칭 + 시작·연속 가중치.
 * 라이브러리 없이 ~20줄. 1만 노트 미만에서 즉각.
 */
export function fuzzyMatch(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;
  if (q === t) return 1000;
  if (t.startsWith(q)) return 800 - (t.length - q.length); // 시작 매칭 강한 가산
  if (t.includes(q)) return 500 - (t.length - q.length);   // 부분 문자열

  // subsequence 매칭
  let qi = 0;
  let prevIdx = -1;
  let score = 100;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (prevIdx === ti - 1) score += 5; // 연속
      if (ti === 0) score += 20;          // 첫 글자
      score += 1;
      prevIdx = ti;
      qi++;
    }
  }
  if (qi < q.length) return null; // 모두 매칭 안 됨
  return score - (t.length - q.length); // 짧을수록 우대
}

export function searchQuick(query: string, entries: QuickEntry[], limit = 30): QuickHit[] {
  if (!query.trim()) {
    return entries
      .slice(0, limit)
      .map((entry) => ({ entry, matchedKey: entry.primaryLabel, score: 0 }));
  }
  const hits: QuickHit[] = [];
  for (const entry of entries) {
    let best: QuickHit | null = null;
    for (const key of entry.matchKeys) {
      const score = fuzzyMatch(query, key);
      if (score === null) continue;
      if (!best || score > best.score) {
        best = { entry, matchedKey: key, score };
      }
    }
    if (best) hits.push(best);
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/* =========================================================
 * 풀텍스트 검색 — Web Worker proxy
 * MiniSearch 인스턴스는 worker thread에 보관. main thread freeze 0.
 * ========================================================= */

export interface FullTextDoc {
  id: string;
  name: string;
  body: string;
}

export interface FullTextHit {
  path: string;
  name: string;
  score: number;
  snippet: string;
}

interface WorkerHit {
  path: string;
  score: number;
  name: string;
}

/**
 * worker `indexes` 배열의 최대 길이 — vault별 실제 shard 수는 `decideShardCount`로 동적 결정.
 * shardId 범위는 항상 `[0, MAX_SHARDS)` 안에 들어와야 worker가 정상 동작.
 */
export const MAX_SHARDS = 16;

/**
 * vault 노트 수 기반 shard 수 결정. 각 shard 약 2000–3000 doc이 첫 shard ready 1–2초 sweet spot.
 *
 * - < 1000: 1 (작은 vault, overhead 제거)
 * - 1000–5000: 2
 * - 5000–15000: 4 (이전 고정값)
 * - 15000–50000: 8
 * - 50000+: 16
 *
 * cache meta(`SearchCacheMeta.shard_count`)에 박제 → 다음 cold-start에서 같은 값 사용.
 * cache miss 빌드 시 결정. vault content_hash 변경 시(노트 추가/삭제 큰 폭) 재결정 가능.
 */
export function decideShardCount(noteCount: number): number {
  if (noteCount < 1000) return 1;
  if (noteCount < 5000) return 2;
  if (noteCount < 15000) return 4;
  if (noteCount < 50000) return 8;
  return 16;
}

type WorkerInMsg =
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

type WorkerOutMsg =
  | { type: "ready"; id: number }
  | { type: "results"; id: number; hits: WorkerHit[] }
  | { type: "json"; id: number; jsonBytes: ArrayBuffer | null }
  | { type: "error"; id: number; error: string };

let workerSingleton: Worker | null = null;
let nextMsgId = 0;
const pending = new Map<number, (data: WorkerOutMsg) => void>();

function getWorker(): Worker {
  if (workerSingleton) return workerSingleton;
  const w = new FullTextWorker();
  w.onmessage = (e: MessageEvent<WorkerOutMsg>) => {
    const handler = pending.get(e.data.id);
    if (handler) {
      pending.delete(e.data.id);
      handler(e.data);
    }
  };
  w.onerror = (e) => {
    console.error("[fulltext-worker] error event", e);
  };
  workerSingleton = w;
  return w;
}

function dispatch<T extends WorkerOutMsg>(
  msg: WorkerInMsg,
  transfer?: Transferable[],
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.set(msg.id, (data) => {
      if (data.type === "error") {
        reject(new Error(data.error));
      } else {
        resolve(data as T);
      }
    });
    getWorker().postMessage(msg, transfer ?? []);
  });
}

/**
 * 특정 shard에 cache 인덱스 로드 (cache hit lazy 시점).
 *
 * **v5 binary**: msgpack 바이너리(ArrayBuffer) 입력. 호출자가 base64 → ArrayBuffer 변환.
 * transferable로 worker에 zero-copy 전송 + worker는 `msgpack.decode` + `MiniSearch.loadJS` 사용.
 */
export async function workerLoadShard(
  shardId: number,
  msgpackBytes: ArrayBuffer,
): Promise<void> {
  const id = ++nextMsgId;
  await dispatch<{ type: "ready"; id: number }>(
    { type: "loadShard", id, shardId, jsonBytes: msgpackBytes },
    [msgpackBytes],
  );
}

/** 특정 shard에 docs addAll (cache miss). 각 shard는 대략 totalDocs/SHARD_COUNT개. */
export async function workerAddAllShard(
  shardId: number,
  docs: FullTextDoc[],
  chunkSize = 200,
): Promise<void> {
  const id = ++nextMsgId;
  await dispatch<{ type: "ready"; id: number }>({
    type: "addAllShard",
    id,
    shardId,
    docs,
    chunkSize,
  });
}

/**
 * doc.path → shardId 결정론 함수. fnv32 hash 후 modulo N.
 * worker와 main이 같은 함수 써야 — sharded query/build 일관.
 * `shardCount`는 vault별로 다름 (`decideShardCount` 참조).
 */
export function computeShardId(path: string, shardCount: number): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % shardCount);
}

/** worker 안 인덱스로 검색. snippet 없이 path+score+name만 반환. */
export async function workerSearch(query: string, limit: number): Promise<WorkerHit[]> {
  const id = ++nextMsgId;
  const r = await dispatch<{ type: "results"; id: number; hits: WorkerHit[] }>({
    type: "search",
    id,
    query,
    limit,
  });
  return r.hits;
}

/**
 * 특정 shard의 인덱스를 msgpack binary로 직렬화 — disk 캐시 저장 직전.
 *
 * **v5 binary**: worker에서 `idx.toJSON()` → `msgpack.encode` → ArrayBuffer transferable로
 * main 전송. 호출자가 base64 변환 후 Rust IPC로 전달.
 */
export async function workerToJSONShard(shardId: number): Promise<ArrayBuffer | null> {
  const id = ++nextMsgId;
  const r = await dispatch<{ type: "json"; id: number; jsonBytes: ArrayBuffer | null }>({
    type: "toJSONShard",
    id,
    shardId,
  });
  return r.jsonBytes;
}

/** worker 안 모든 shard 인덱스 release. clearIndexes에서 호출. */
export async function workerReset(): Promise<void> {
  const id = ++nextMsgId;
  await dispatch<{ type: "ready"; id: number }>({ type: "resetAll", id });
}

/**
 * Rust IPC ↔ JS bytes 통과 helper — Tauri 2 JSON IPC가 Vec<u8>를 number array로
 * 비효율 직렬화하는 문제를 base64로 회피.
 *
 * 5MB bytes ↔ ~6.7MB base64. encode/decode 비용 ~50ms each (main thread sync).
 */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(""));
}

/**
 * 풀텍스트 검색 — async, worker proxy.
 *
 * - worker가 path/score/name 반환
 * - main에서 매 hit마다 readNote(path)로 body lazy fetch → snippet 생성
 * - 한 노트 read 실패 시 그 결과만 skip
 *
 * 호출자(`palette.ts:matchContent`)도 async 체인. 인덱스 인자는 안 받음(worker singleton).
 */
export async function searchFullText(
  query: string,
  limit = 30,
): Promise<FullTextHit[]> {
  const q = query.trim();
  if (!q) return [];
  const workerHits = await workerSearch(q, limit);
  if (workerHits.length === 0) return [];
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const RADIUS = 60;

  const hits = await Promise.all(
    workerHits.map(async (h): Promise<FullTextHit | null> => {
      let body = "";
      try {
        body = await readNote(h.path);
      } catch (e) {
        console.warn(`[search] readNote failed for ${h.path}`, e);
        return null;
      }
      const { snippet, matched } = extractSnippetAround(body, tokens, RADIUS);
      const finalSnippet = matched
        ? snippet
        : body.slice(0, RADIUS * 2).replace(/\s+/g, " ").trim() + "…";
      return {
        path: h.path,
        name: h.name,
        score: h.score,
        snippet: finalSnippet,
      };
    }),
  );
  return hits.filter((h): h is FullTextHit => h !== null);
}
