import MiniSearch from "minisearch";
import type { NoteContent, LinkInfo } from "$lib/tauri/notes";

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

export function buildFullTextIndex(notes: NoteContent[]): MiniSearch<FullTextDoc> {
  const index = new MiniSearch<FullTextDoc>({
    fields: ["name", "body"],
    storeFields: ["name", "body"],
    idField: "id",
    searchOptions: {
      boost: { name: 3 },
      prefix: true,
      fuzzy: 0.15,
    },
  });
  for (const n of notes) {
    index.add({ id: n.path, name: n.name, body: n.body });
  }
  return index;
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
  const index = new MiniSearch<FullTextDoc>({
    fields: ["name", "body"],
    storeFields: ["name", "body"],
    idField: "id",
    searchOptions: {
      boost: { name: 3 },
      prefix: true,
      fuzzy: 0.15,
    },
  });
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

export function searchFullText(
  query: string,
  index: MiniSearch<FullTextDoc>,
  limit = 30,
): FullTextHit[] {
  const q = query.trim();
  if (!q) return [];
  const results = index.search(q);
  return results.slice(0, limit).map((r) => ({
    path: r.id as string,
    name: (r as unknown as { name: string }).name,
    score: r.score,
    snippet: makeSnippet((r as unknown as { body: string }).body, q),
  }));
}

function makeSnippet(body: string, query: string, radius = 60): string {
  const lower = body.toLowerCase();
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  let bestIdx = -1;
  for (const t of tokens) {
    const i = lower.indexOf(t);
    if (i !== -1 && (bestIdx === -1 || i < bestIdx)) bestIdx = i;
  }
  if (bestIdx === -1) return body.slice(0, radius * 2).replace(/\s+/g, " ").trim() + "…";
  const start = Math.max(0, bestIdx - radius);
  const end = Math.min(body.length, bestIdx + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  return prefix + body.slice(start, end).replace(/\s+/g, " ").trim() + suffix;
}
