import { get } from "svelte/store";
import type MiniSearch from "minisearch";
import {
  fuzzyMatch,
  searchQuick,
  searchFullText,
  type QuickEntry,
  type FullTextDoc,
} from "$lib/searchIndex";
import { quickEntries, fullTextIndex } from "$lib/stores/search";
import { tagIndex, type TagIndex } from "$lib/stores/tags";
import { docKindCounts, topicCounts } from "$lib/stores/filters";
import { matchCommands, type Command } from "$lib/commands";

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
  | { kind: "command"; command: Command };

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

function matchContent(
  query: string,
  index: MiniSearch<FullTextDoc> | null,
  limit = 20,
): PaletteResult[] {
  if (!index || !query.trim()) return [];
  const hits = searchFullText(query, index, limit);
  return hits.map((h) => ({
    entry: { kind: "content", path: h.path, name: h.name, snippet: h.snippet },
    score: normalizedScore("content", h.score),
  }));
}

function commandsAsResults(query: string, limit = 20): PaletteResult[] {
  const hits = matchCommands(query, limit);
  return hits.map((h) => ({
    entry: { kind: "command", command: h.command },
    score: normalizedScore("command", h.score),
  }));
}

/**
 * 통합 검색. mode에 따라 어떤 그룹을 채울지 결정.
 * - 같은 path를 가진 note와 content 결과는 점수 높은 쪽만 유지 (dedupe).
 */
export function unifiedSearch(input: string, hint: PaletteMode = "all"): PaletteResult[] {
  const { mode, query } = parseInput(input, hint);

  if (mode === "command") return commandsAsResults(query);
  if (mode === "tag") return matchTags(query, get(tagIndex));
  if (mode === "facet") return matchFacets(query);
  if (mode === "files") return matchFiles(query, get(quickEntries));
  if (mode === "fulltext") return matchContent(query, get(fullTextIndex));

  // all 모드 — 빈 query는 빈 결과 (Recent는 4.5.b)
  if (!query) return [];

  const files = matchFiles(query, get(quickEntries));
  const content = matchContent(query, get(fullTextIndex));
  const tags = matchTags(query, get(tagIndex));
  const facets = matchFacets(query);
  const cmds = commandsAsResults(query);

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
  return merged.slice(0, 30);
}

/** 그룹별로 결과 분할 — UI 렌더링용. 빈 그룹은 제외하지 않음(헤더 결정은 UI에서). */
export interface ResultGroups {
  notes: PaletteResult[];
  content: PaletteResult[];
  tags: PaletteResult[];
  facets: PaletteResult[];
  commands: PaletteResult[];
}

export function groupResults(results: PaletteResult[]): ResultGroups {
  const groups: ResultGroups = {
    notes: [],
    content: [],
    tags: [],
    facets: [],
    commands: [],
  };
  for (const r of results) {
    switch (r.entry.kind) {
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
