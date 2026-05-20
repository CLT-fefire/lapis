import MiniSearch, { type Options } from "minisearch";
import type { NoteContent, LinkInfo } from "$lib/tauri/notes";
import { readNote } from "$lib/tauri/notes";
import { extractSnippetAround } from "$lib/snippet";

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
 * 풀텍스트 검색 (MiniSearch)
 * ========================================================= */

export interface FullTextDoc {
  id: string;     // path
  name: string;
  body: string;
}

export interface FullTextHit {
  path: string;
  name: string;
  score: number;
  snippet: string;
}

/**
 * MiniSearch 옵션 — 빌드/loadJSON 모두 같은 객체 사용 필수.
 * 본 옵션이 변경되면 `src-tauri/src/search_cache.rs`의 `CACHE_VERSION`을 bump해야
 * 기존 disk 캐시가 invalidate됨 (옵션 mismatch 시 search 결과 깨짐).
 *
 * **storeFields=["name"]만**: body를 인덱스 JSON에 저장하지 않음 → cache JSON 크기
 * 12MB → ~2–3MB. cache hit cacheLookup + loadJSON 비용 큰 폭 감소.
 * 검색 결과 snippet 생성을 위해 `searchFullText`가 매 hit마다 `readNote`를 호출.
 * 30 IPC × ~5ms = ~150ms 추가지만 cache hit 전체 단축이 훨씬 큼.
 */
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

export function buildFullTextIndex(notes: NoteContent[]): MiniSearch<FullTextDoc> {
  const index = new MiniSearch<FullTextDoc>(FULLTEXT_OPTIONS);
  for (const n of notes) {
    index.add({ id: n.path, name: n.name, body: n.body });
  }
  return index;
}

/**
 * disk 캐시(`search_cache.rs`)에 저장된 `MiniSearch.toJSON()` 문자열에서 인덱스 복원.
 * 옵션은 빌드와 동일해야 검색 결과 일관. 파싱 실패 시 null(호출자가 cache miss로 fallback).
 */
export function loadFullTextIndexFromJson(json: string): MiniSearch<FullTextDoc> | null {
  try {
    return MiniSearch.loadJSON(json, FULLTEXT_OPTIONS) as MiniSearch<FullTextDoc>;
  } catch (e) {
    console.warn("[search-cache] loadJSON failed → cache miss fallback", e);
    return null;
  }
}

/**
 * 대규모 vault(>1000노트) 대응 chunked 빌드.
 * MiniSearch.addAll은 fields 토크나이즈 비용이 크고 sync라 JS main thread를 길게 점유 →
 * 다른 앱 응답성/UI 인터랙션 영향. CHUNK 단위로 끊고 `await Promise(setTimeout 0)`로
 * event loop yield → UI/OS 메시지 처리 시간 확보.
 *
 * 1000노트 미만은 buildFullTextIndex 사용해도 충분. 10000+ 노트 export 직후엔 이쪽 호출.
 */
export async function buildFullTextIndexChunked(
  notes: NoteContent[],
  chunkSize = 200,
): Promise<MiniSearch<FullTextDoc>> {
  const index = new MiniSearch<FullTextDoc>(FULLTEXT_OPTIONS);
  for (let i = 0; i < notes.length; i += chunkSize) {
    const chunk = notes.slice(i, i + chunkSize);
    // MiniSearch.addAll은 내부 루프 — chunk size만큼만 한 번에 처리
    index.addAll(
      chunk.map((n) => ({ id: n.path, name: n.name, body: n.body })),
    );
    // event loop yield — 다음 chunk 전에 macro task로 양보
    if (i + chunkSize < notes.length) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }
  return index;
}

/**
 * 풀텍스트 검색 — async.
 *
 * storeFields가 ["name"]만이라 body가 결과에 없음. snippet 생성을 위해 매 hit마다
 * `readNote(path)`로 본문을 lazy fetch. 30건 limit이면 IPC ~30 × ~5ms = ~150ms.
 * 한 노트 read 실패 시 그 결과만 skip (전체 검색 흐름은 진행).
 *
 * 호출자(palette.ts:matchContent → unifiedSearch)도 async 체인.
 */
export async function searchFullText(
  query: string,
  index: MiniSearch<FullTextDoc>,
  limit = 30,
): Promise<FullTextHit[]> {
  const q = query.trim();
  if (!q) return [];
  const results = index.search(q);
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const RADIUS = 60;

  const slice = results.slice(0, limit);
  const hits = await Promise.all(
    slice.map(async (r): Promise<FullTextHit | null> => {
      const path = r.id as string;
      let body = "";
      try {
        body = await readNote(path);
      } catch (e) {
        // 파일이 사라졌거나 권한 변경 — 그 결과만 skip
        console.warn(`[search] readNote failed for ${path}`, e);
        return null;
      }
      // 백링크 컨텍스트와 동일한 발췌 로직 공유. 매칭 없으면 본문 앞자락으로 fallback.
      const { snippet, matched } = extractSnippetAround(body, tokens, RADIUS);
      const finalSnippet = matched
        ? snippet
        : body.slice(0, RADIUS * 2).replace(/\s+/g, " ").trim() + "…";
      return {
        path,
        name: (r as unknown as { name: string }).name,
        score: r.score,
        snippet: finalSnippet,
      };
    }),
  );
  return hits.filter((h): h is FullTextHit => h !== null);
}
