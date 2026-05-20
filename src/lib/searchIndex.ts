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

type WorkerInMsg =
  | { type: "loadJSON"; id: number; jsonBytes: ArrayBuffer }
  | { type: "addAll"; id: number; docs: FullTextDoc[]; chunkSize?: number }
  | { type: "search"; id: number; query: string; limit: number }
  | { type: "toJSON"; id: number }
  | { type: "reset"; id: number };

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
 * worker에 cache JSON 보내고 인덱스 복원 (cache hit lazy 시점).
 *
 * **transferable ArrayBuffer** — string structured clone(WebKit에서 30MB가 ~32s)
 * 대신 zero-copy. JSON string → TextEncoder UTF-8 bytes → ArrayBuffer → postMessage
 * 두 번째 인자에 transfer list. main thread 비용 ms 단위.
 */
export async function workerLoadJSON(json: string): Promise<void> {
  const id = ++nextMsgId;
  const bytes = new TextEncoder().encode(json);
  await dispatch<{ type: "ready"; id: number }>(
    { type: "loadJSON", id, jsonBytes: bytes.buffer },
    [bytes.buffer],
  );
}

/** worker에서 풀 빌드 (cache miss). docs는 main에서 contents → {id, name, body} 변환 후 전달. */
export async function workerAddAll(docs: FullTextDoc[], chunkSize = 200): Promise<void> {
  const id = ++nextMsgId;
  await dispatch<{ type: "ready"; id: number }>({ type: "addAll", id, docs, chunkSize });
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
 * worker 인덱스를 JSON 직렬화 — disk 캐시 저장 직전.
 *
 * worker 안에서 JSON.stringify 후 UTF-8 bytes → ArrayBuffer transferable로 main 전송.
 * main에서 TextDecoder로 string 복원. clone 0.
 */
export async function workerToJSON(): Promise<string | null> {
  const id = ++nextMsgId;
  const r = await dispatch<{ type: "json"; id: number; jsonBytes: ArrayBuffer | null }>({
    type: "toJSON",
    id,
  });
  if (!r.jsonBytes) return null;
  return new TextDecoder().decode(new Uint8Array(r.jsonBytes));
}

/** worker 안 인덱스 release. clearIndexes에서 호출. */
export async function workerReset(): Promise<void> {
  const id = ++nextMsgId;
  await dispatch<{ type: "ready"; id: number }>({ type: "reset", id });
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
