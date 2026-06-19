import type { NoteContent, LinkInfo } from "$lib/tauri/notes";
import { readNote } from "$lib/tauri/notes";
import { extractSnippetAround } from "$lib/snippet";
import { chosungOf, isChosungQuery } from "$lib/hangul";
import FullTextWorker from "./fullTextWorker?worker";

/* =========================================================
 * Quick Switcher (파일명 / alias / title fuzzy 매칭)
 * MiniSearch 없이 직접 구현 — 가벼움, 빠름
 * ========================================================= */

export interface QuickEntry {
  path: string;
  primaryLabel: string;   // 표시용 (title || name)
  matchKeys: string[];    // 매칭 대상 (name, aliases, title 모두)
  chosungKeys: string[];  // matchKeys와 1:1 초성 형태 (초성 쿼리 매칭용, 선계산)
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
    const matchKeys = [...keys];
    return {
      path: info.source_path,
      primaryLabel: info.title ?? info.source_name,
      matchKeys,
      chosungKeys: matchKeys.map(chosungOf), // 초성 쿼리 매칭용 선계산(키 입력마다 재계산 회피)
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
  // "ㄱㅂㅈ"처럼 자음만이면 초성 검색: 각 키의 초성 형태에 매칭하되, 표시용 matchedKey는
  // 원본 키(title/name)로 유지. 일반 쿼리는 기존 fuzzy 경로.
  const chosungMode = isChosungQuery(query);
  const hits: QuickHit[] = [];
  for (const entry of entries) {
    const keys = chosungMode ? entry.chosungKeys : entry.matchKeys;
    let best: QuickHit | null = null;
    for (let i = 0; i < keys.length; i++) {
      const score = fuzzyMatch(query, keys[i]);
      if (score === null) continue;
      if (!best || score > best.score) {
        best = { entry, matchedKey: entry.matchKeys[i], score };
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

export interface WorkerHit {
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
      type: "addToShard";
      id: number;
      shardId: number;
      docs: FullTextDoc[];
      reset: boolean;
    }
  | { type: "toJSONShard"; id: number; shardId: number }
  | { type: "updateDoc"; id: number; shardId: number; doc: FullTextDoc }
  | { type: "removeDoc"; id: number; shardId: number; docId: string }
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
 * 특정 shard에 cache JSON 로드 (cache hit lazy 시점).
 *
 * **transferable ArrayBuffer** — string structured clone(WebKit에서 30MB가 ~32s)
 * 대신 zero-copy. JSON string → TextEncoder UTF-8 bytes → ArrayBuffer → postMessage
 * 두 번째 인자에 transfer list. main thread 비용 ms 단위.
 */
export async function workerLoadShard(shardId: number, json: string): Promise<void> {
  const id = ++nextMsgId;
  const bytes = new TextEncoder().encode(json);
  await dispatch<{ type: "ready"; id: number }>(
    { type: "loadShard", id, shardId, jsonBytes: bytes.buffer },
    [bytes.buffer],
  );
}

/**
 * 특정 shard에 docs 한 배치를 추가 (cache miss 풀 빌드).
 *
 * `reset=true`면 shard 인덱스를 새로 만들고 추가(첫 배치), false면 기존에 append.
 * **caller(`rebuildIndexes`)가 shard를 작은 배치로 나눠 호출**하는 이유: 한 shard 전체
 * (수천 doc × body)를 한 번에 postMessage하면 WKWebView가 main thread에서 structured
 * clone에 수 초를 써 UI(인덱스 빌드 스피너 포함)가 freeze된다. 배치마다 await(worker
 * 왕복)로 main thread가 양보돼 스피너가 계속 돈다.
 */
export async function workerAddToShard(
  shardId: number,
  docs: FullTextDoc[],
  reset: boolean,
): Promise<void> {
  const id = ++nextMsgId;
  await dispatch<{ type: "ready"; id: number }>({
    type: "addToShard",
    id,
    shardId,
    docs,
    reset,
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
 * 특정 shard의 MiniSearch 인덱스 JSON 직렬화 — disk 캐시 저장 직전.
 *
 * worker 안에서 JSON.stringify 후 UTF-8 bytes → ArrayBuffer transferable로 main 전송.
 * main에서 TextDecoder로 string 복원. clone 0.
 */
export async function workerToJSONShard(shardId: number): Promise<string | null> {
  const id = ++nextMsgId;
  const r = await dispatch<{ type: "json"; id: number; jsonBytes: ArrayBuffer | null }>({
    type: "toJSONShard",
    id,
    shardId,
  });
  if (!r.jsonBytes) return null;
  return new TextDecoder().decode(new Uint8Array(r.jsonBytes));
}

/**
 * 단일 노트 증분 갱신 — 해당 shard에 add/replace. 외부 파일 변경 watcher 경로에서 호출.
 * vault 전체 재빌드(read_vault_bundle) 없이 바뀐 노트만 풀텍스트에 반영.
 */
export async function workerUpdateDoc(
  shardId: number,
  doc: FullTextDoc,
): Promise<void> {
  const id = ++nextMsgId;
  await dispatch<{ type: "ready"; id: number }>({
    type: "updateDoc",
    id,
    shardId,
    doc,
  });
}

/** 단일 노트 증분 삭제 — 해당 shard에서 discard. 없으면 무시. */
export async function workerRemoveDoc(
  shardId: number,
  docId: string,
): Promise<void> {
  const id = ++nextMsgId;
  await dispatch<{ type: "ready"; id: number }>({
    type: "removeDoc",
    id,
    shardId,
    docId,
  });
}

/** worker 안 모든 shard 인덱스 release. clearIndexes에서 호출. */
export async function workerReset(): Promise<void> {
  const id = ++nextMsgId;
  await dispatch<{ type: "ready"; id: number }>({ type: "resetAll", id });
}

/**
 * 풀텍스트 랭킹만 — worker가 path/score/name 반환. **IO·snippet 없음**(저비용).
 *
 * 스니펫은 `buildContentSnippet`로 **표시 대상 hit에만** 지연 생성한다 — dedupe·결과 컷으로
 * 탈락하는 hit에 대해 `readNote`(디스크 IO + IPC)를 낭비하지 않기 위함.
 * 호출자(`palette.ts:matchContent`)도 async 체인. 인덱스 인자는 안 받음(worker singleton).
 */
export async function searchFullTextRanked(
  query: string,
  limit = 30,
): Promise<WorkerHit[]> {
  const q = query.trim();
  if (!q) return [];
  return workerSearch(q, limit);
}

const SNIPPET_RADIUS = 60;

/**
 * 단일 노트의 검색 스니펫 생성 — `readNote` 1회 + 매치 주변 추출. 실패 시 빈 문자열.
 * 최종 표시 결과에만 호출(불필요한 디스크 IO 회피).
 */
export async function buildContentSnippet(path: string, query: string): Promise<string> {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let body = "";
  try {
    body = await readNote(path);
  } catch (e) {
    console.warn(`[search] readNote failed for ${path}`, e);
    return "";
  }
  const { snippet, matched } = extractSnippetAround(body, tokens, SNIPPET_RADIUS);
  return matched
    ? snippet
    : body.slice(0, SNIPPET_RADIUS * 2).replace(/\s+/g, " ").trim() + "…";
}
