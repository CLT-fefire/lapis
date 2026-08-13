/**
 * `lapis_query` — 도구 하나. **판단하지 않는다.**
 *
 * ```
 * 사용자 → Claude Code → MCP → Lapis 캐시
 *            (판단)      (실행만)
 * ```
 *
 * LLM도 API 키도 없다. 같은 인자 → 같은 결과. 결과가 나쁘면 원인이 둘로만 좁혀진다 —
 * 인자를 잘못 채웠나 / 인덱스에 없나.
 *
 * ## 상주 비용 (2026-08-13 실측, 19,222 노트)
 *
 * | | 콜드 | RSS |
 * |---|---:|---:|
 * | 구조 팔 | 196 ms | **201 MB** |
 * | + BM25 8 shard | +1,400 ms | ~1,030 MB |
 * |
 * 5배 차이라 **BM25는 `text` 인자가 처음 올 때만 로드**한다. 판정 4문항 중 3개가 구조 팔이다.
 */

import { readFileSync, statSync } from "node:fs";
import MiniSearch from "minisearch";
import {
  applyFilters,
  buildIndex,
  buildTagIndex,
  koBigramTokenize,
  normalizeTerm,
  unionRank,
  FULLTEXT_OPTIONS,
  type FullTextDoc,
  type LinkIndex,
  type LinkInfo,
} from "./entry.ts";
import { LapisError, checkStale, loadShards, norm, resolveVault, type VaultCache } from "./cache.ts";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const SNIPPET_MAX = 180;

/**
 * 기본 제외 — 과거 세션 아카이브. vault의 **94%**(18,039/19,222)를 차지해서 BM25 상위를
 * 익사시킨다(판정 세션: *"매번 손으로 빼야 하는 게 제일 큰 마찰"*).
 *
 * ⚠️ 반대로 **grep은 이 트리에서 4문항 전부 0건**이었다 — 작업 기록은 "창"으로 쓰였고
 * 질의는 "윈도우"였다(어휘 불일치). 같은 코퍼스가 한 팔은 못 닿고 한 팔은 압도당한다.
 * 그래서 지우는 게 아니라 **기본 제외 + `include_archive`로 되돌릴 수 있게** 한다.
 */
const ARCHIVE_PREFIXES = ["_memories"];

/** 결과 1건. `score`는 구조 전용 결과에서 null. */
export interface ResultRow {
  path: string;
  score: number | null;
  sources: string[];
  doc_kind: string | null;
  topic: string | null;
  title: string | null;
  snippet: string | null;
  /** `backlinks_of`에서 이 문서가 걸린 근거 — `link` · `fm:related` 등. */
  via?: string[];
}

interface ResponseBase {
  vault: string;
  loaded_fingerprint: string;
  excluded: string[];
}

export interface FacetListResponse extends ResponseBase {
  list: "topics" | "tags" | "doc_kinds";
  total_distinct: number;
  returned: number;
  truncated: boolean;
  values: { value: string; count: number }[];
}

export interface SearchResponse extends ResponseBase {
  /** 판별자 — `list` 응답과 구별한다. */
  list?: undefined;
  used: Record<string, unknown>[];
  resolved_target?: string;
  returned: number;
  structural_count: number;
  truncated: boolean;
  results: ResultRow[];
}

/** `list` 인자를 주면 `FacetListResponse`, 아니면 `SearchResponse`. */
export type QueryResponse = FacetListResponse | SearchResponse;

export interface QueryArgs {
  vault?: string;
  text?: string;
  doc_kind?: string;
  topic?: string;
  tag?: string;
  backlinks_of?: string;
  list?: "topics" | "tags" | "doc_kinds";
  sources?: ("bm25" | "structural")[];
  exclude?: string[];
  include_archive?: boolean;
  limit?: number;
}

interface Loaded {
  vc: VaultCache;
  metaMs: number;
  link: LinkIndex;
  tags: ReturnType<typeof buildTagIndex>;
  rel: (abs: string) => string;
}

let ST: Loaded | null = null;
let BM: MiniSearch<FullTextDoc>[] | null = null;

function loadStructural(vaultArg?: string): Loaded {
  // 앱이 재빌드하면 우리 메모리는 낡는다 — meta mtime 1회 stat으로 감지해 다시 읽는다.
  if (ST) {
    const fresh = statSync(ST.vc.metaFile).mtimeMs;
    if (fresh === ST.metaMs && (!vaultArg || ST.vc.root === norm(vaultArg))) return ST;
    BM = null; // 인덱스가 바뀌었으면 풀텍스트도 무효다
  }
  const vc = resolveVault(vaultArg);
  const cut = vc.root.endsWith("/") ? vc.root.length : vc.root.length + 1;
  ST = {
    vc,
    metaMs: statSync(vc.metaFile).mtimeMs,
    link: buildIndex(vc.infos),
    tags: buildTagIndex(vc.infos),
    rel: (abs) => norm(abs).slice(cut),
  };
  return ST;
}

function loadBm25(st: Loaded): MiniSearch<FullTextDoc>[] {
  if (BM) return BM;
  BM = loadShards(st.vc).map(
    (json) => MiniSearch.loadJSON(json, FULLTEXT_OPTIONS) as MiniSearch<FullTextDoc>,
  );
  return BM;
}

/** 경로 해소 — 절대 / vault 상대 / 노트 이름(alias·title·stem) 전부 받는다. */
function resolveNote(st: Loaded, input: string): string {
  const raw = norm(input);
  if (st.link.byPath.has(raw)) return raw;
  const asAbs = raw.startsWith("/") ? raw : `${st.vc.root}/${raw}`;
  if (st.link.byPath.has(asAbs)) return asAbs;
  // resolver는 alias > title > stem 우선순위. grep이 접두 충돌(`ADR-001` → `ADR-0010`)로
  // 오탐을 내던 자리를 정확 해소로 대체한다.
  const stem = raw.replace(/\.md$/, "").split("/").pop() ?? raw;
  const viaResolver = st.link.resolver.get(stem.toLowerCase());
  if (viaResolver) return viaResolver;
  throw new LapisError(
    "path_not_indexed",
    `인덱스에 없는 경로: ${input}`,
    "vault 상대 POSIX 경로 또는 노트 이름을 써라. (이건 '백링크 0건'과 다른 상태다)",
  );
}

/**
 * `exclude`는 **문자열 prefix**다.
 *
 * ⚠️ 처음엔 디렉터리 경계(`x + "/"`)로 맞췄는데, 그러면 `lapis/plans/lapis-cli-`처럼
 * 세그먼트 중간에서 끊는 prefix가 **조용히 no-op**이 된다(판정 세션이 잡았다 —
 * 자기오염 제외가 안 걸린 채 판정이 돌았다).
 * 부작용: `_memories`가 `_memories-old/`도 뺀다. 문서화로 감수한다.
 */
const excluded = (rel: string, prefixes: string[]): boolean =>
  prefixes.some((x) => rel.startsWith(x));

/**
 * 매칭 스니펫. 경로만 돌려주면 소비자가 결국 파일을 읽고, **그게 grep 팔이 바이트를 쓰는
 * 바로 그 지점**이다(판정에서 grep의 45 KB 중 95%가 Read였다). 상한 내 결과만 읽는다(≤50).
 */
function snippet(abs: string, text?: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(abs, "utf8");
  } catch {
    return null;
  }
  const lines = raw.split("\n");
  let i = 0;
  if (lines[0]?.trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i].trim() !== "---") i++;
    i++;
  }
  // frontmatter를 건너뛴다 — vault의 99.6%가 YAML로 시작해서, 안 건너뛰면 스니펫이
  // 질의와 무관하게 항상 YAML이 된다(앱의 `searchIndex.ts` fallback이 겪는 문제다).
  const body = lines.slice(i).filter((l) => l.trim().length > 0);
  if (body.length === 0) return null;

  let best = body[0];
  if (text) {
    const terms = [...new Set(koBigramTokenize(text.toLowerCase()).map(normalizeTerm))].filter(
      (t) => t.length >= 2,
    );
    let bestHits = 0;
    for (const l of body) {
      const low = l.toLowerCase();
      let hits = 0;
      for (const t of terms) if (low.includes(t)) hits++;
      if (hits > bestHits) {
        bestHits = hits;
        best = l;
      }
    }
  }
  const clean = best.replace(/^[#>\-*\s]+/, "").trim();
  return clean.length > SNIPPET_MAX ? clean.slice(0, SNIPPET_MAX) + "…" : clean;
}

/**
 * facet 값 열거 — **판정이 지목한 최대 마찰**을 닫는다.
 *
 * "전부 찾아라"의 완결성은 결국 `topic` 정확일치가 냈는데, 판정 세션은 `tag-system` ·
 * `multi-window` 같은 **값을 BM25 결과 메타에 우연히 노출돼서** 알았다. `topic`을 쓸지
 * `tag`를 쓸지 판단할 근거도 응답 안에 없었다. 값을 찍어 맞히게 하지 않는다.
 */
function listFacet(
  st: Loaded,
  kind: NonNullable<QueryArgs["list"]>,
  cap: number,
  ex: string[],
): Omit<FacetListResponse, keyof ResponseBase> {
  const infos = st.vc.infos.filter((i) => !excluded(st.rel(i.source_path), ex));
  const counts = new Map<string, number>();
  const bump = (v: string) => counts.set(v, (counts.get(v) ?? 0) + 1);
  for (const i of infos) {
    if (kind === "topics" && i.topic) bump(i.topic);
    else if (kind === "doc_kinds" && i.doc_kind) bump(i.doc_kind);
    else if (kind === "tags") for (const t of i.tags ?? []) bump(norm(t));
  }
  const all = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    list: kind,
    total_distinct: all.length,
    returned: Math.min(all.length, cap),
    truncated: all.length > cap,
    values: all.slice(0, cap).map(([value, count]) => ({ value, count })),
  };
}

export function lapisQuery(args: QueryArgs = {}): QueryResponse {
  const {
    vault,
    text,
    doc_kind,
    topic,
    tag,
    backlinks_of,
    list,
    sources,
    exclude = [],
    include_archive = false,
    limit = DEFAULT_LIMIT,
  } = args;

  const wantsStructural = Boolean(doc_kind || topic || tag || backlinks_of);
  if (!list && !text && !wantsStructural) {
    throw new LapisError(
      "no_criteria",
      "조건이 하나도 없다.",
      "text · doc_kind · topic · tag · backlinks_of 중 최소 하나를 채우거나, " +
        "list:\"topics\"|\"tags\"|\"doc_kinds\"로 쓸 수 있는 값부터 확인하라.",
    );
  }

  const cap = Math.min(Math.max(1, Math.trunc(limit) || DEFAULT_LIMIT), MAX_LIMIT);
  const ex = [...exclude.map(norm), ...(include_archive ? [] : ARCHIVE_PREFIXES)];
  const allow = new Set<string>(sources ?? ["bm25", "structural"]);

  if (!list) {
    const effective =
      (text && allow.has("bm25")) || (wantsStructural && allow.has("structural"));
    if (!effective) {
      throw new LapisError(
        "no_criteria",
        `sources=${JSON.stringify([...allow])} 가 준 인자를 전부 잘라냈다.`,
        "sources를 넓히거나, 남긴 팔이 쓰는 인자를 채워라.",
      );
    }
  }

  const st = loadStructural(vault);

  // stale은 fail-closed — MCP는 인덱스를 만들 수 없다(생산자가 앱이다).
  const fresh = checkStale(st.vc);
  if (fresh.stale) {
    throw new LapisError(
      "stale",
      `vault가 캐시보다 새롭다 (최신 노트 ${new Date(fresh.newestMs).toISOString()} > ` +
        `캐시 ${new Date(fresh.metaMs).toISOString()}).`,
      "Lapis 앱을 실행해라. watcher가 2초 안에 인덱스를 갱신한다. " +
        "MCP는 인덱스를 만들지 않는다 — 생산자는 앱이다.",
    );
  }

  const base = {
    vault: st.vc.root,
    loaded_fingerprint: st.vc.fingerprint,
    excluded: ex,
  };

  if (list) return { ...base, ...listFacet(st, list, cap, ex) };

  const used: Record<string, unknown>[] = [];
  const via = new Map<string, string[]>();
  let pool: Set<string> | null = null;
  let resolvedTarget: string | null = null;

  if (wantsStructural && allow.has("structural")) {
    if (backlinks_of) {
      resolvedTarget = resolveNote(st, backlinks_of);
      // "이 문서를 참조하는 문서" = 본문 백링크 ∪ frontmatter relations.
      // ⚠️ `linkIndex.backlinks`는 **본문 wikilink/md-link 전용**이고 frontmatter cross-ref는
      // `relations.incoming`이 따로 든다(`linkIndex.ts:11-16`). 본문만 보면 판정 #4에서
      // `related`·`amends`·`superseded_by`로만 걸린 3건을 통째로 놓친다(8건 중 5건만 나온다).
      const body = st.link.backlinks.get(resolvedTarget) ?? new Set<string>();
      const fm = st.link.relations.incoming.get(resolvedTarget) ?? [];
      const hit = new Set(body);
      for (const p of body) via.set(p, ["link"]);
      for (const r of fm) {
        const src = norm(r.path);
        if (src === resolvedTarget) continue;
        hit.add(src);
        via.set(src, [...(via.get(src) ?? []), `fm:${r.type}`]);
      }
      pool = hit;
      used.push({
        name: "refs",
        corpus_size: st.link.byPath.size,
        matched: hit.size,
        body: body.size,
        frontmatter: fm.length,
      });
    }

    if (tag) {
      const t = norm(tag);
      const hit = new Set<string>();
      for (const info of st.vc.infos) {
        // nested prefix — `tech`를 주면 `tech/*` 전부.
        if ((info.tags ?? []).some((x) => {
          const n = norm(x);
          return n === t || n.startsWith(t + "/");
        })) {
          hit.add(info.source_path);
        }
      }
      pool = pool === null ? hit : new Set([...pool].filter((p) => hit.has(p)));
      used.push({ name: "tag", corpus_size: st.tags.byTag.size, matched: hit.size });
    }

    if (doc_kind || topic) {
      const src = pool === null ? st.vc.infos : st.vc.infos.filter((i) => pool!.has(i.source_path));
      const f = applyFilters(
        src,
        new Set(doc_kind ? [doc_kind] : []),
        new Set(topic ? [topic] : []),
      );
      pool = new Set(f.map((i: LinkInfo) => i.source_path));
      used.push({ name: "facet", corpus_size: st.vc.infos.length, matched: pool.size });
    }
  }

  let ranked: { path: string; score: number }[] = [];
  if (text && allow.has("bm25")) {
    const idxs = loadBm25(st);
    ranked = unionRank(idxs, text, 0)
      .map((h) => ({ path: norm(h.path), score: h.score }))
      .filter((h) => !excluded(st.rel(h.path), ex));
    used.push({
      name: "bm25",
      corpus_size: idxs.reduce((n, i) => n + i.documentCount, 0),
      matched: ranked.length,
      lazy_loaded_now: BM !== null,
    });
  }

  const row = (abs: string, score: number | null, srcs: string[]): ResultRow => {
    const i = st.link.byPath.get(abs);
    return {
      path: st.rel(abs),
      score,
      sources: srcs,
      doc_kind: i?.doc_kind ?? null,
      topic: i?.topic ?? null,
      title: i?.title ?? null,
      snippet: snippet(abs, text),
      ...(via.has(abs) ? { via: via.get(abs) } : {}),
    };
  };

  // ── 병합 — 인자 조합에 따라 구조 팔의 성격이 다르다 ──────────────────
  //  · 구조만        → **집합**이다. 전건 싣고 자르지 않는다.
  //  · 구조 + text   → **필터**다. 교집합을 BM25 점수로 정렬한다.
  // ⚠️ "구조는 언제나 안 자른다"로 두면 넓은 facet이 랭킹 없이 앞을 다 채운다.
  //    실측: `{text:"태그 체계", doc_kind:"solution"}`이 solution 130건을 무순위로 쏟아
  //    정답이 **#128**. 이 규칙으로 고친 뒤 **#2**.
  const results: ResultRow[] = [];
  const seen = new Set<string>();
  let structuralCount = 0;
  let truncated = false;

  if (pool !== null && text && allow.has("bm25")) {
    for (const r of ranked) {
      if (results.length >= cap) break;
      if (!pool.has(r.path) || seen.has(r.path)) continue;
      seen.add(r.path);
      results.push(row(r.path, Number(r.score.toFixed(4)), ["structural", "bm25"]));
    }
    structuralCount = results.length;
    // 구조엔 있는데 BM25가 못 본 건은 점수 없이 뒤에 붙인다(집합 정보 보존).
    for (const abs of pool) {
      if (seen.has(abs) || excluded(st.rel(abs), ex)) continue;
      if (results.length >= cap) {
        truncated = true;
        break;
      }
      seen.add(abs);
      results.push(row(abs, null, ["structural"]));
    }
  } else {
    const bmSet = new Set(ranked.map((r) => r.path));
    for (const abs of pool ?? []) {
      if (excluded(st.rel(abs), ex)) continue;
      seen.add(abs);
      results.push(row(abs, null, bmSet.has(abs) ? ["structural", "bm25"] : ["structural"]));
    }
    structuralCount = results.length;
    // 구조 집합은 상한을 넘어도 자르지 않는다 — 잘림을 모르면 "인덱스에 없다"와 혼동한다.
    truncated = structuralCount > cap;
    for (const r of ranked) {
      if (results.length >= Math.max(cap, structuralCount)) break;
      if (seen.has(r.path)) continue;
      seen.add(r.path);
      results.push(row(r.path, Number(r.score.toFixed(4)), ["bm25"]));
    }
  }

  // 필수 메타를 배열 **앞에** 둔다 — 응답이 잘려도 `used`·`vault`가 살아남게.
  return {
    ...base,
    used,
    ...(resolvedTarget ? { resolved_target: st.rel(resolvedTarget) } : {}),
    returned: results.length,
    structural_count: structuralCount,
    truncated,
    results,
  };
}

/** 테스트용 — 상주 상태 초기화. */
export function resetState(): void {
  ST = null;
  BM = null;
}
