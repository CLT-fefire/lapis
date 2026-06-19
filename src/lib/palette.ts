import { get } from "svelte/store";
import {
  fuzzyMatch,
  searchQuick,
  searchFullTextRanked,
  buildContentSnippet,
  type QuickEntry,
} from "$lib/searchIndex";
import { quickEntries, fullTextIndexReady } from "$lib/stores/search";
import { tagIndex, type TagIndex } from "$lib/stores/tags";
import { docKindCounts, topicCounts } from "$lib/stores/filters";
import { matchCommands, BUILTIN_COMMANDS, type Command } from "$lib/commands";
import { recentNotePaths, RECENT_DISPLAY } from "$lib/stores/recent";

/**
 * 팔레트 모드.
 * - "all"      : prefix 없음. 모든 그룹 통합.
 * - "command"  : `>` 명령만.
 * - "tag"      : `#` 태그만.
 * - "facet"    : `:` doc_kind / topic 만.
 * - "files"    : Cmd+P 호환. NOTES 그룹만.
 * - "fulltext" : Cmd+Shift+F 호환. CONTENT 그룹만.
 */
export type PaletteMode = "all" | "command" | "tag" | "facet" | "files" | "fulltext";

export type PaletteEntry =
  | { kind: "note"; path: string; label: string; subtitle?: string }
  | { kind: "content"; path: string; name: string; snippet: string }
  | { kind: "tag"; key: string; display: string; mode: "leaf" | "prefix"; count: number }
  | { kind: "facet"; field: "doc_kind" | "topic"; value: string; count: number }
  | { kind: "command"; command: Command }
  | { kind: "recent"; path: string; label: string; subtitle?: string };

export interface PaletteResult {
  entry: PaletteEntry;
  score: number;
}

export interface ParsedInput {
  mode: PaletteMode;
  query: string;
}

/** raw 입력 + 호환 모드 → 실제 사용할 mode와 query. */
export function parseInput(raw: string, hint: PaletteMode = "all"): ParsedInput {
  // hint가 "files"/"fulltext"면 prefix 무시하고 그 모드 유지 (Cmd+P/Cmd+Shift+F 호환)
  if (hint === "files" || hint === "fulltext") {
    return { mode: hint, query: raw.trim() };
  }
  if (raw.startsWith(">")) return { mode: "command", query: raw.slice(1).trim() };
  if (raw.startsWith("#")) return { mode: "tag", query: raw.slice(1).trim() };
  if (raw.startsWith(":")) return { mode: "facet", query: raw.slice(1).trim() };
  return { mode: "all", query: raw.trim() };
}

/**
 * kind별 raw 점수를 정규화. 각 검색 엔진의 점수 분포가 매우 다르므로 비교 가능한 단위로.
 * - file fuzzyMatch    : 100-1000
 * - command fuzzyMatch : 100-1000 (약간 우대)
 * - tag fuzzyMatch     : 100-1000 (약간 감점)
 * - facet              : 정확 매칭만 → 고정 700
 * - content MiniSearch : 1-20 정도 → ×60 으로 0-1200
 */
export function normalizedScore(kind: PaletteEntry["kind"], raw: number): number {
  switch (kind) {
    case "note":
      return raw;
    case "command":
      return raw * 1.2;
    case "tag":
      return raw * 0.85;
    case "facet":
      return 700;
    case "content":
      return raw * 60;
    case "recent":
      // Recent는 항상 빈 입력 흐름에서만 등장 — 그룹 안에서의 정렬만 유지하면 됨
      return raw;
  }
}

function matchTags(query: string, index: TagIndex | null, limit = 20): PaletteResult[] {
  if (!index) return [];
  const q = query.trim();
  const out: PaletteResult[] = [];

  // leaf 태그
  for (const key of index.sortedTags) {
    const display = index.display.get(key) ?? key;
    const count = index.counts.get(key) ?? 0;
    if (!q) {
      out.push({
        entry: { kind: "tag", key, display, mode: "leaf", count },
        score: normalizedScore("tag", 0),
      });
    } else {
      const s = fuzzyMatch(q, key);
      if (s !== null) {
        out.push({
          entry: { kind: "tag", key, display, mode: "leaf", count },
          score: normalizedScore("tag", s),
        });
      }
    }
  }

  // prefix 태그 — 같은 키가 leaf로 이미 들어갔으면 skip
  const seen = new Set(out.map((r) => (r.entry as { key: string }).key));
  for (const key of index.rootPrefixes) {
    if (seen.has(key)) continue;
    const display = index.display.get(key) ?? key;
    const count = index.prefixCounts.get(key) ?? 0;
    if (!q) {
      out.push({
        entry: { kind: "tag", key, display, mode: "prefix", count },
        score: normalizedScore("tag", 0),
      });
    } else {
      const s = fuzzyMatch(q, key);
      if (s !== null) {
        out.push({
          entry: { kind: "tag", key, display, mode: "prefix", count },
          score: normalizedScore("tag", s),
        });
      }
    }
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

function matchFacets(query: string, limit = 20): PaletteResult[] {
  const q = query.trim().toLowerCase();
  const out: PaletteResult[] = [];

  const docKinds = get(docKindCounts);
  const topics = get(topicCounts);

  function consider(field: "doc_kind" | "topic", value: string, count: number) {
    if (!q) {
      out.push({
        entry: { kind: "facet", field, value, count },
        score: normalizedScore("facet", 0),
      });
      return;
    }
    if (value.toLowerCase().includes(q)) {
      out.push({
        entry: { kind: "facet", field, value, count },
        score: normalizedScore("facet", 0),
      });
    }
  }

  for (const [value, count] of docKinds) consider("doc_kind", value, count);
  for (const [value, count] of topics) consider("topic", value, count);

  // 정확 매칭이 부분 매칭보다 위로 — 시작·완전 매칭에 보너스
  out.sort((a, b) => {
    const va = (a.entry as { value: string }).value.toLowerCase();
    const vb = (b.entry as { value: string }).value.toLowerCase();
    const ea = va === q ? 2 : va.startsWith(q) ? 1 : 0;
    const eb = vb === q ? 2 : vb.startsWith(q) ? 1 : 0;
    if (ea !== eb) return eb - ea;
    return (b.entry as { count: number }).count - (a.entry as { count: number }).count;
  });
  return out.slice(0, limit);
}

function matchFiles(query: string, entries: QuickEntry[], limit = 20): PaletteResult[] {
  const hits = searchQuick(query, entries, limit);
  return hits.map((h) => ({
    entry: {
      kind: "note",
      path: h.entry.path,
      label: h.entry.primaryLabel,
      subtitle:
        h.matchedKey !== h.entry.primaryLabel
          ? `alias: ${h.matchedKey}${h.entry.parentPath ? " · " + h.entry.parentPath : ""}`
          : h.entry.parentPath || undefined,
    },
    score: normalizedScore("note", h.score),
  }));
}

async function matchContent(query: string, limit = 20): Promise<PaletteResult[]> {
  if (!query.trim()) return [];
  if (!get(fullTextIndexReady)) return []; // worker 인덱스가 아직 빌드 중 — CommandPalette UI에 안내
  // 랭킹만(저비용). snippet은 표시 대상에만 fillContentSnippets로 지연 생성 — dedupe·컷으로
  // 탈락하는 hit에 readNote(디스크 IO) 낭비 방지.
  const hits = await searchFullTextRanked(query, limit);
  return hits.map((h) => ({
    entry: { kind: "content", path: h.path, name: h.name, snippet: "" },
    score: normalizedScore("content", h.score),
  }));
}

/** content 결과에 스니펫을 채운다(readNote × content 건수). 최종 표시 집합에만 호출. */
async function fillContentSnippets(results: PaletteResult[], query: string): Promise<void> {
  await Promise.all(
    results.map(async (r) => {
      if (r.entry.kind === "content") {
        r.entry.snippet = await buildContentSnippet(r.entry.path, query);
      }
    }),
  );
}

function commandsAsResults(query: string, limit = 20): PaletteResult[] {
  const hits = matchCommands(query, limit);
  return hits.map((h) => ({
    entry: { kind: "command", command: h.command },
    score: normalizedScore("command", h.score),
  }));
}

/**
 * Recent 노트 결과. 현재 vault에 존재하지 않는 path는 자동 필터.
 * 점수는 단순 역순 인덱스 — 최근일수록 큰 값. 그룹 안에서 정렬을 유지한다.
 */
function recentAsResults(limit: number = RECENT_DISPLAY): PaletteResult[] {
  const paths = get(recentNotePaths);
  if (paths.length === 0) return [];
  const entries = get(quickEntries);
  const byPath = new Map(entries.map((e) => [e.path, e]));

  const out: PaletteResult[] = [];
  for (const path of paths) {
    if (out.length >= limit) break;
    const qe = byPath.get(path);
    if (!qe) continue; // vault에 없는 path는 표시 안 함
    out.push({
      entry: {
        kind: "recent",
        path: qe.path,
        label: qe.primaryLabel,
        subtitle: qe.parentPath || undefined,
      },
      score: normalizedScore("recent", paths.length - paths.indexOf(path)),
    });
  }
  return out;
}

/** 빌트인 명령 전체 (빈 입력 시 QUICK ACTIONS 그룹용) — 비활성 명령은 제외. */
function quickActionsAsResults(): PaletteResult[] {
  return BUILTIN_COMMANDS.filter((c) => !c.disabled?.()).map((command, i) => ({
    entry: { kind: "command", command },
    score: normalizedScore("command", BUILTIN_COMMANDS.length - i),
  }));
}

/**
 * 통합 검색. mode에 따라 어떤 그룹을 채울지 결정.
 * - 같은 path를 가진 note와 content 결과는 점수 높은 쪽만 유지 (dedupe).
 *
 * **async**: `matchContent`가 storeFields=["name"]만 캐시한 인덱스 사용 → snippet 생성을
 * 위해 매 hit마다 `readNote`를 호출하므로 async 체인. files/tags/facets/commands는 sync.
 */
export async function unifiedSearch(
  input: string,
  hint: PaletteMode = "all",
): Promise<PaletteResult[]> {
  const { mode, query } = parseInput(input, hint);

  if (mode === "command") return commandsAsResults(query);
  if (mode === "tag") return matchTags(query, get(tagIndex));
  if (mode === "facet") return matchFacets(query);
  if (mode === "files") {
    // 호환 모드: 빈 입력에선 Recent 노출, 입력 있으면 file fuzzy
    return query ? matchFiles(query, get(quickEntries)) : recentAsResults();
  }
  if (mode === "fulltext") {
    if (!query) return recentAsResults();
    const content = await matchContent(query);
    await fillContentSnippets(content, query); // 전부 표시되므로 모두 생성
    return content;
  }

  // all 모드 — 빈 query면 Recent + Quick Actions
  if (!query) return [...recentAsResults(), ...quickActionsAsResults()];

  // content는 IPC(readNote × N) 동반이라 다른 sync 빌더와 병렬로 진행
  const files = matchFiles(query, get(quickEntries));
  const contentP = matchContent(query);
  const tags = matchTags(query, get(tagIndex));
  const facets = matchFacets(query);
  const cmds = commandsAsResults(query);
  const content = await contentP;

  // path 중복 제거: file과 content가 같은 노트를 가리키면 더 높은 score만 유지
  const byPath = new Map<string, PaletteResult>();
  for (const r of files) {
    const p = (r.entry as { path: string }).path;
    const prev = byPath.get(p);
    if (!prev || r.score > prev.score) byPath.set(p, r);
  }
  for (const r of content) {
    const p = (r.entry as { path: string }).path;
    const prev = byPath.get(p);
    if (!prev || r.score > prev.score) byPath.set(p, r);
  }

  const merged = [...byPath.values(), ...tags, ...facets, ...cmds];
  merged.sort((a, b) => b.score - a.score);
  const final = merged.slice(0, 30);
  // 최종 컷에 든 content에만 스니펫 생성 — dedupe(파일과 같은 path)·30컷으로 탈락한 hit은 IO 안 함.
  await fillContentSnippets(final, query);
  return final;
}

/** 그룹별로 결과 분할 — UI 렌더링용. 빈 그룹은 제외하지 않음(헤더 결정은 UI에서). */
export interface ResultGroups {
  recents: PaletteResult[];
  notes: PaletteResult[];
  content: PaletteResult[];
  tags: PaletteResult[];
  facets: PaletteResult[];
  commands: PaletteResult[];
}

export function groupResults(results: PaletteResult[]): ResultGroups {
  const groups: ResultGroups = {
    recents: [],
    notes: [],
    content: [],
    tags: [],
    facets: [],
    commands: [],
  };
  for (const r of results) {
    switch (r.entry.kind) {
      case "recent":
        groups.recents.push(r);
        break;
      case "note":
        groups.notes.push(r);
        break;
      case "content":
        groups.content.push(r);
        break;
      case "tag":
        groups.tags.push(r);
        break;
      case "facet":
        groups.facets.push(r);
        break;
      case "command":
        groups.commands.push(r);
        break;
    }
  }
  return groups;
}
