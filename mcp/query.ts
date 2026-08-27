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
  parseSince,
  parseFrontmatterDate,
  partitionSince,
  sortRecent,
  sortPath,
  SinceError,
  type TimeOf,
} from "$lib/recency";
import {
  applyFilters,
  buildIndex,
  buildTagIndex,
  koBigramTokenize,
  normalizeTerm,
  unionRankDetailed,
  FULLTEXT_OPTIONS,
  type FullTextDoc,
  type LinkIndex,
  type LinkInfo,
} from "./entry.ts";
import {
  LapisError,
  checkStale,
  walkVaultEntries,
  type Staleness,
  loadShards,
  norm,
  normPath,
  normalizeVaultArg,
  resolveVault,
  type VaultCache,
} from "./cache.ts";
import { findBrokenLinks } from "$lib/brokenLinks";
import {
  findOrphans,
  findTagIssues,
  findAmbiguousNames,
  findFrontmatterIssues,
  findUnlinkedMentions,
} from "$lib/vaultAudit";

/**
 * vault 상대 경로로. **응답 경로는 전부 상대다** — `lapisQuery` 의 기존 계약과 같다.
 *
 * ⚠️ `$lib` 쪽 순수 함수는 절대 경로를 낸다(앱이 그걸로 노트를 연다). 자르는 건
 * 표면의 몫이고, 여기가 그 표면이다.
 */
function relativize(root: string, abs: string): string {
  const cut = root.endsWith("/") ? root.length : root.length + 1;
  return abs.startsWith(root) ? abs.slice(cut) : abs;
}

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

/** 결과 1건. `score`·`rel`은 구조 전용 결과에서 null. */
export interface ResultRow {
  path: string;
  score: number | null;
  /**
   * 질의 내 상대 점수 `[0,1]`. top-1이 1.0.
   *
   * `score`(raw BM25)는 질의마다 스케일이 달라 행 간 비교밖에 안 된다. 이 값은
   * 질의를 가로질러 비교되므로 "0.3 아래는 안 본다" 같은 판단에 쓸 수 있다.
   */
  rel: number | null;
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
  /**
   * 캐시가 vault보다 낡았을 때만 실린다. **없으면 최신이라는 뜻.**
   * 있으면 몇 개가 얼마나 앞서는지 보고 판단하라 — 보통 몇 건이면 결과에 영향이 없다.
   */
  stale?: Staleness;
  excluded: string[];
}

export interface FacetListResponse extends ResponseBase {
  list: "topics" | "tags" | "doc_kinds";
  total_distinct: number;
  returned: number;
  truncated: boolean;
  values: { value: string; count: number }[];
}

/**
 * ⚠️ 감사 응답을 **먼저 걸러 내는** 좁히기 도우미.
 *
 * 소비자(테스트 포함)가 `list`·`returned` 를 읽으려 할 때 `AuditResponse` 가 섞여 있으면
 * 타입이 막는다. 그건 옳지만, 매번 손으로 좁히면 실수한다.
 */
export function isAudit(r: QueryResponse): r is AuditResponse {
  return "audit" in r && r.audit !== undefined;
}

/** 쓸 수 있는 감사. **앱·CLI와 같은 다섯**이다 — 여기만 다르면 답이 갈린다. */
export const AUDIT_KINDS = ["broken", "orphans", "unlinked", "tags", "props"] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

export interface AuditResponse extends ResponseBase {
  /** 판별자 — `list`·검색 응답과 구별한다. */
  audit: AuditKind;
  /** 몇 건인가. 종류마다 세는 단위가 달라 `unit` 이 같이 온다. */
  count: number;
  /** `count` 가 무엇의 개수인지 — `대상`·`노트`·`이름`·`묶음`. */
  unit: string;
  rows: unknown[];
}

export interface SearchResponse extends ResponseBase {
  /** 판별자 — `list`·감사 응답과 구별한다. */
  list?: undefined;
  audit?: undefined;
  used: Record<string, unknown>[];
  resolved_target?: string;
  /** 실제로 실린 행 수. 항상 `limit` 이하. */
  returned: number;
  /** 실린 행 중 구조 팔에서 온 수. */
  structural_count: number;
  /** 구조 팔 집합의 **전체** 크기(상한 적용 전). 구조 인자가 없으면 0. */
  structural_total: number;
  /** 상한 때문에 **실제로 버린 행이 있는가**. 구조·BM25 어느 쪽이든 포함. */
  truncated: boolean;
  results: ResultRow[];
}

/** `list` 인자를 주면 `FacetListResponse`, 아니면 `SearchResponse`. */
export type QueryResponse = FacetListResponse | SearchResponse | AuditResponse;

export interface QueryArgs {
  vault?: string;
  text?: string;
  doc_kind?: string;
  topic?: string;
  tag?: string;
  backlinks_of?: string;
  list?: "topics" | "tags" | "doc_kinds";
  /**
   * vault 위생 감사 하나. 앱과 CLI가 쓰는 **같은 순수 함수**를 부른다.
   *
   * ⚠️ 왜 `all` 이 없나 — `unlinked` 만 **본문을 전부 읽는다**(나머지는 인덱스로 된다).
   * `all` 에 넣으면 값싼 넷을 물을 때마다 그 비용을 문다. 넣지 않으면서 `all` 이라
   * 부르면 거짓말이다. 한 번에 하나씩 고르게 한다.
   */
  audit?: AuditKind;
  sources?: ("bm25" | "structural")[];
  exclude?: string[];
  include_archive?: boolean;
  limit?: number;
  /**
   * BM25 결과의 **상대 점수 하한** `[0,1]`. 생략하면 거르지 않는다.
   *
   * raw `score`는 질의 간 비교가 안 돼(63점 vs 1,494점) 임계값을 못 세웠다.
   * `rel`은 그 질의 안에서 top-1을 1.0으로 둔 값이라 질의를 가로질러 쓸 수 있다.
   *
   * `OR`/`OR-min` 단계로 떨어져 결과가 넓게 나올 때 꼬리를 자르는 용도다.
   * ⚠️ 단계마다 모집단이 달라 같은 값이 같은 뜻은 아니다 — `used[].combine`을 함께 본다.
   */
  min_rel?: number;
  /**
   * 이 시점 이후만. `7d` · `24h` · `2w` · `2026-08-01`.
   *
   * ⚠️ 시간 값이 없는 노트는 **빠지고, 몇 개인지 응답에 남는다**
   * (`used[].dropped_no_time`). 조용히 줄이지 않는다.
   */
  since?: string;
  /**
   * 결과 순서. `recent` · `path` · `score`.
   *
   * 기본은 지금까지의 동작이다 — 점수가 있으면 점수순, 없으면 경로순.
   * ⚠️ `score`를 구조 질의(점수가 없는 질의)에 주면 사용법 오류다.
   */
  sort?: "recent" | "path" | "score";
  /**
   * 시간축. `mtime`(기본) · `date`(프론트매터).
   *
   * ⚠️ `git pull`·`checkout`이 mtime을 덮어쓴다 — 새로 클론하면 전부 같은 값이다.
   * 두 머신을 git으로 동기화하면 `date` 쪽이 사실에 가깝다. 자세한 것은 `$lib/recency`.
   */
  by?: "mtime" | "date";
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
    // ⚠️ `resolveVault`와 **같은 정규형**으로 비교해야 한다. 예전엔 여기서 `norm()`만
    // 했는데 `resolveVault`는 `path.resolve()` + 후행 슬래시 제거까지 한다. 그래서
    // `vault: ".../knowledge/"` 처럼 슬래시 하나만 달라도 매 호출 전체 재로드 +
    // `BM = null`로 풀텍스트 8 shard 재로드(실측 1.4초)가 일어났다.
    const wantRoot = vaultArg ? normalizeVaultArg(vaultArg) : null;
    let fresh: number | null = null;
    try {
      fresh = statSync(ST.vc.metaFile).mtimeMs;
    } catch {
      // 질의 사이에 캐시가 지워졌다(v7 GC·수동 정리). 생 ENOENT를 던지면 소비자에게
      // `kind:"internal"`로 나가 복구 방법을 알려주지 못한다 → 아래에서 재해소한다.
      ST = null;
      BM = null;
    }
    if (ST && fresh === ST.metaMs && (!wantRoot || ST.vc.root === wantRoot)) return ST;
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

/**
 * 문자열 오름차순 — **UTF-16 코드 단위** 비교다.
 *
 * ⚠️ `localeCompare()`를 쓰지 않는다. 인자 없이 부르면 **실행 환경의 로케일**을 따르고
 * (Node는 full-icu가 기본이다), 그러면 같은 캐시를 `ko_KR` 머신과 `en_US` 머신에서
 * 질의했을 때 **순서가 갈린다.** 한글이 든 경로·태그에서 특히 그렇다.
 *
 * 이 도구의 존재 이유가 "같은 인자면 같은 결과"이므로, 정렬은 로케일에 의존하면 안 된다.
 */
const asc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** 경로 해소 — 절대 / vault 상대 / 노트 이름(alias·title·stem) 전부 받는다. */
function resolveNote(st: Loaded, input: string): string {
  const raw = norm(input);
  if (st.link.byPath.has(raw)) return raw;
  const asAbs = raw.startsWith("/") ? raw : `${st.vc.root}/${raw}`;
  if (st.link.byPath.has(asAbs)) return asAbs;
  // resolver는 alias > title > stem 우선순위. grep이 접두 충돌(`ADR-001` → `ADR-0010`)로
  // 오탐을 내던 자리를 정확 해소로 대체한다.
  const stem = raw.replace(/\.md$/, "").split("/").pop() ?? raw;
  const candidates = st.link.resolver.get(stem.toLowerCase());

  // ## ⚠️ 모호하면 추측하지 않는다
  //
  // 문서 안의 링크와 달리 **사람이 준 이름에는 맥락이 없다.** 어느 프로젝트를 뜻하는지
  // 알 방법이 없으므로 하나를 고르면 조용히 틀린다.
  //
  // 예전엔 `resolver`가 경로 하나만 들고 있었고 그게 vault walk 순서로 정해졌다. 그래서
  // `lapis open STATE`가 늘 먼저 걸린 프로젝트의 것을 열었고, **그게 이 결함이 안 보였던
  // 이유다.** 이제 후보를 보여주고 사람이 좁히게 한다.
  if (candidates && candidates.length > 1) {
    const shown = candidates.map((c) => st.rel(c));
    throw new LapisError(
      "name_ambiguous",
      `이름이 여럿에 걸린다: ${input} (${candidates.length}건)`,
      `경로로 좁혀라 — ${shown.join(" · ")}`,
    );
  }
  if (candidates && candidates.length === 1) return candidates[0];

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
 *
 * 앱의 `buildFacetCounts`를 쓰지 않는다 — 그쪽은 doc_kind·topic **둘만** 세고 `tags`도
 * `exclude`도 모른다. 세 종류를 한 순회로 처리하는 편이 doc_kind/topic만 위임하고 tags를
 * 따로 도는 것보다 단순하다. ⚠️ 대신 **카운트 규칙이 갈릴 수 있다** — 앱 facet 패널과
 * 숫자가 어긋나면 여기부터 본다.
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
  const all = [...counts].sort((a, b) => b[1] - a[1] || asc(a[0], b[0]));
  return {
    list: kind,
    total_distinct: all.length,
    returned: Math.min(all.length, cap),
    truncated: all.length > cap,
    values: all.slice(0, cap).map(([value, count]) => ({ value, count })),
  };
}

/**
 * 노트 지시자 → **절대 경로 + 그 vault 루트**.
 *
 * `lapis open`이 쓴다. 앱에 넘길 때 vault 루트가 함께 필요하다 — **어느 창이 받을지**를
 * 그걸로 가르기 때문이다(`src-tauri/src/cliopen.rs`).
 *
 * ⚠️ 해소 규칙을 CLI가 따로 두지 않으려고 여기 둔다. `backlinks`가 쓰는 것과 **같은
 * 함수**라, `lapis backlinks X`가 찾는 노트와 `lapis open X`가 여는 노트가 항상 같다.
 */
export function resolveNotePath(input: string, vault?: string): { path: string; vault: string } {
  const st = loadStructural(vault);
  return { path: resolveNote(st, input), vault: st.vc.root };
}

/**
 * 이 질의의 시간축 값을 내는 함수.
 *
 * ⚠️ **`mtime`은 `checkStale`이 이미 하는 walk를 재사용한다**(`walkVaultEntries`).
 * 따로 훑으면 매 질의에 walk가 둘이 되고, 더 나쁘게는 두 walk 사이에 vault가 바뀌어
 * fingerprint와 시간 값이 어긋난 답을 낸다.
 *
 * `date`는 캐시의 `props.date`에서 온다 — 추가 IO가 없다.
 */
/**
 * vault의 시간축 공급자 — CLI의 감사 명령이 쓴다.
 *
 * `lapisQuery`를 거치지 않는 경로(`links --orphans`)도 **같은 시간 값**을 봐야 한다.
 * 여기서 내보내지 않으면 소비자가 각자 walk를 짜고, 그러면 축의 뜻이 갈린다.
 */
export function vaultTimeOf(vault: string | undefined, axis: "mtime" | "date"): TimeOf {
  return timeSource(loadStructural(vault), axis);
}
function timeSource(st: Loaded, axis: "mtime" | "date"): TimeOf {
  if (axis === "date") {
    const cache = new Map<string, number | null>();
    return (abs) => {
      if (cache.has(abs)) return cache.get(abs)!;
      const raw = st.link.byPath.get(abs)?.props?.date?.[0];
      const ms = raw ? parseFrontmatterDate(raw) : null;
      cache.set(abs, ms);
      return ms;
    };
  }
  const times = new Map<string, number>();
  // ⚠️ walk는 **vault 상대** 경로를 낸다. 키는 **절대** 경로여야 한다(`byPath`와 같은 형태).
  // 처음엔 `root.slice(0, cut) + rel` 로 붙였는데 구분자가 빠져 조회가 **전부 null**이 됐다
  // — 그러면 `--since`가 모든 노트를 "시간 값 없음"으로 버리고 `--sort recent`는 경로순으로
  // 조용히 떨어진다. 실측에서 20건이 통째로 사라졌다.
  const prefix = st.vc.root.endsWith("/") ? st.vc.root : st.vc.root + "/";
  for (const e of walkVaultEntries(st.vc).entries) {
    times.set(prefix + e.rel, e.mtimeMs);
  }
  return (abs) => times.get(abs) ?? null;
}
/**
 * 감사 하나를 돌린다.
 *
 * ## ⚠️ 앱·CLI와 **같은 순수 함수**를 부른다
 *
 * `$lib/brokenLinks` · `$lib/vaultAudit` 하나뿐이다. MCP가 자기 판정을 따로 두면 AI가 보는
 * vault 상태와 사람이 보는 상태가 갈린다 — 그러면 둘 중 누가 맞는지 아무도 모른다.
 *
 * ⚠️ `unlinked` 만 **본문을 전부 읽는다.** 그래서 `all` 을 안 둔다(위 `audit` 주석).
 */
function runAudit(
  st: Loaded,
  kind: AuditKind,
  cap: number,
): { audit: AuditKind; count: number; unit: string; rows: unknown[]; truncated: boolean } {
  const rel = (p: string) => relativize(st.vc.root, p);
  const cut = <T>(rows: T[]) => ({ rows: rows.slice(0, cap), truncated: rows.length > cap });

  switch (kind) {
    case "broken": {
      const all = findBrokenLinks(st.link).map((g) => ({
        target: g.target,
        sources: g.sources.map((s) => ({ ...s, path: rel(s.path) })),
      }));
      return { audit: kind, count: all.length, unit: "대상", ...cut(all) };
    }
    case "orphans": {
      const all = findOrphans(st.link).map((o) => ({ ...o, path: rel(o.path) }));
      return { audit: kind, count: all.length, unit: "노트", ...cut(all) };
    }
    case "tags": {
      const issues = findTagIssues(st.vc.infos);
      const ambiguous = findAmbiguousNames(st.link).map((a) => ({
        ...a,
        paths: a.paths.map(rel),
      }));
      const all = [...issues, ...ambiguous.map((a) => ({ kind: "ambiguous" as const, ...a }))];
      return { audit: kind, count: all.length, unit: "묶음", ...cut(all) };
    }
    case "props": {
      const all = findFrontmatterIssues(st.link);
      return { audit: kind, count: all.length, unit: "묶음", ...cut(all) };
    }
    case "unlinked": {
      const bodies = new Map<string, string>();
      for (const info of st.vc.infos) {
        try {
          bodies.set(info.source_path, readFileSync(info.source_path, "utf8"));
        } catch {
          // 캐시에는 있는데 디스크에서 사라진 노트. 그 노트만 빠진다.
        }
      }
      const all = findUnlinkedMentions(st.link, bodies).map((r) => ({
        ...r,
        target: rel(r.target),
        sources: r.sources.map((x) => ({ ...x, path: rel(x.path) })),
      }));
      return { audit: kind, count: all.length, unit: "이름", ...cut(all) };
    }
  }
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
    audit,
    sources,
    exclude = [],
    include_archive = false,
    limit = DEFAULT_LIMIT,
    min_rel: minRelArg = 0,
    since,
    sort,
    by: axis = "mtime",
  } = args;

  const wantsStructural = Boolean(doc_kind || topic || tag || backlinks_of);
  if (!list && !audit && !text && !wantsStructural) {
    throw new LapisError(
      "no_criteria",
      "조건이 하나도 없다.",
      "text · doc_kind · topic · tag · backlinks_of 중 최소 하나를 채우거나, " +
        "list:\"topics\"|\"tags\"|\"doc_kinds\"로 쓸 수 있는 값부터 확인하거나, " +
        `audit:"${AUDIT_KINDS.join('"|"')}"로 vault 위생을 물어라.`,
    );
  }

  // ⚠️ `Math.trunc(limit) || DEFAULT_LIMIT`로 쓰면 `limit: 0`이 10으로 조용히 바뀐다
  // (falsy-zero). 아래 `Math.max(1, …)`가 이미 하한을 보장하므로 폴백은 NaN만 잡는다.
  const wanted = Math.trunc(limit);
  const cap = Math.min(Math.max(1, Number.isFinite(wanted) ? wanted : DEFAULT_LIMIT), MAX_LIMIT);
  // `min_rel`은 `[0,1]` 밖 값을 조용히 받지 않는다 — 1.5를 주면 전부 걸러져
  // "인덱스가 비었다"로 오해하게 된다. NaN도 0으로 떨어뜨려 필터를 끈다.
  const minRel = Number.isFinite(minRelArg) ? Math.min(Math.max(minRelArg, 0), 1) : 0;
  const ex = [...exclude.map(norm), ...(include_archive ? [] : ARCHIVE_PREFIXES)];
  const allow = new Set<string>(sources ?? ["bm25", "structural"]);

  // ⚠️ 상대 기간(`7d`)은 본질적으로 "지금"에 의존한다. 테스트는 절대 날짜를 쓴다 —
  // 그러면 같은 인자가 언제 돌려도 같은 결과를 낸다.
  const nowMs = Date.now();

  // ⚠️ 사용법 오류는 **질의 전에** 잡는다. 뒤에서 조용히 무시하면 사용자는 인자가
  // 먹은 줄 안다.
  if (sort === "score" && !text) {
    throw new LapisError(
      "no_criteria",
      "sort: \"score\" 는 text 질의에만 쓸 수 있다",
      "구조 질의에는 점수가 없다 — sort: \"recent\" 또는 \"path\"",
    );
  }
  if (axis !== "mtime" && axis !== "date") {
    throw new LapisError(
      "no_criteria",
      `모르는 시간축: ${String(axis)}`,
      "mtime(파일 수정 시각) 또는 date(프론트매터)",
    );
  }
  if (sort !== undefined && sort !== "recent" && sort !== "path" && sort !== "score") {
    throw new LapisError(
      "no_criteria",
      `모르는 정렬: ${String(sort)}`,
      "recent · path · score",
    );
  }

  // ⚠️ `list` 와 `audit` 은 **팔을 안 쓴다.** 이 검사에 걸리면 감사 요청이
  //    "sources 가 인자를 잘라냈다"로 죽는다 — 실제로 그랬다.
  if (!list && !audit) {
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

  // staleness는 **보고**한다 — 막지 않는다. 살아 있는 vault는 커밋(10~20초) 사이에도
  // 계속 쓰이므로, 0.016%가 새롭다는 이유로 모든 질의를 세우면 도구를 못 쓴다.
  // 판단은 Claude Code가 한다(이 서버의 원칙).
  const stale = checkStale(st.vc);

  const base = {
    vault: st.vc.root,
    loaded_fingerprint: st.vc.fingerprint,
    // ⚠️ 조건이 `newer_count`가 아니라 `changed`다. 프록시는 **수정만 있는 변경**을
    // 놓쳤다 — 새 파일이 없으면 0이라 "최신"이라고 답했다. v8부터 fingerprint를
    // 재현할 수 있어 정확히 판정한다.
    ...(stale.changed ? { stale } : {}),
    excluded: ex,
  };

  if (list) return { ...base, ...listFacet(st, list, cap, ex) };
  if (audit) return { ...base, ...runAudit(st, audit, cap) };

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

  let ranked: { path: string; score: number; rel: number }[] = [];
  if (text && allow.has("bm25")) {
    // ⚠️ `loadBm25` **전에** 잡아야 한다. 뒤에서 `BM !== null`을 읽으면 항상 true다
    // (실측: 이미 로드된 2·3회차도 true였다 — 지연 로드를 확인했다고 착각하게 만든다).
    const wasLoaded = BM !== null;
    const idxs = loadBm25(st);
    const { hits, combine } = unionRankDetailed(idxs, text, 0);
    ranked = hits
      .map((h) => ({ path: normPath(h.path), score: h.score, rel: h.rel }))
      .filter((h) => !excluded(st.rel(h.path), ex));

    // `min_rel` 적용 — **자른 건수를 남긴다.** 조용히 줄이면 "왜 안 나오지"의
    // 원인이 인자였다는 걸 알 방법이 없다.
    const beforeMinRel = ranked.length;
    if (minRel > 0) ranked = ranked.filter((h) => h.rel >= minRel);
    const droppedByMinRel = beforeMinRel - ranked.length;
    used.push({
      name: "bm25",
      corpus_size: idxs.reduce((n, i) => n + i.documentCount, 0),
      matched: ranked.length,
      // 어느 단계에서 나왔는지 — `AND`(전부 든 문서) → `AND-1`(하나 빼고 AND) →
      // `OR-min`(OR + 매칭 term 임계) → `OR`(마지막 수단). **AND가 아니면 질의 단어 중
      // 일부가 인덱스에 없다는 신호**다(오타이거나, 그 표현이 vault에 없거나).
      // 결과가 넓으면 이 값을 먼저 본다. 값 목록은 `mcp/README.md` 동작 5번.
      combine,
      lazy_loaded_now: !wasLoaded,
      ...(minRel > 0 ? { min_rel: minRel, dropped_by_min_rel: droppedByMinRel } : {}),
    });
  }

  const row = (abs: string, score: number | null, rel: number | null, srcs: string[]): ResultRow => {
    const i = st.link.byPath.get(abs);
    return {
      path: st.rel(abs),
      score,
      rel,
      sources: srcs,
      doc_kind: i?.doc_kind ?? null,
      topic: i?.topic ?? null,
      title: i?.title ?? null,
      snippet: snippet(abs, text),
      ...(via.has(abs) ? { via: via.get(abs) } : {}),
    };
  };

  // ── 병합 — 인자 조합에 따라 구조 팔의 성격이 다르다 ──────────────────
  //  · 구조만        → **집합**이다. 상한 안에서 구조를 먼저 싣는다.
  //  · 구조 + text   → **필터**다. 교집합을 BM25 점수로 정렬한다.
  //
  // ⚠️ "구조는 언제나 안 자른다"로 두면 넓은 facet이 랭킹 없이 앞을 다 채운다.
  //    실측: `{text:"태그 체계", doc_kind:"solution"}`이 solution 130건을 무순위로 쏟아
  //    정답이 **#128**. 구조를 먼저 채우는 규칙으로 고친 뒤 **#2**.
  //
  // ⚠️ 그런데 그걸 "pool 전건을 싣는다"로 구현하면 **`limit`이 무의미해지고 응답이
  //    무제한이 된다.** 실측 `{doc_kind:"solution", limit:10}`이 **130행 38 KB**,
  //    `{tag:"tech", limit:10}`이 **284행 72 KB**였다(행마다 `snippet` 파일 읽기까지).
  //    grep 베이스라인이 4문항 45 KB였으니 단일 질의가 그보다 컸다 — 이 도구의 존재
  //    이유를 스스로 무너뜨린다. 원래 의도는 "BM25 노이즈가 구조 결과를 밀어내지 않게"
  //    였으므로 **구조 우선 + 상한 준수 + `structural_total`로 집합 크기 통보**로 만족시킨다.

  const results: ResultRow[] = [];
  const seen = new Set<string>();

  // 상한과 무관한 구조 집합의 전체 크기. 잘림 판정과 통보에 쓴다.
  //
  // ## ⚠️ 정렬한다 — 관련도가 아니라 **결정성** 때문이다
  //
  // `pool`은 `Set`이고 순회 순서는 삽입 순서다. 그 삽입 순서는 캐시의 `link_infos` 순서에서
  // 오고, 그건 **캐시를 어떻게 만들었느냐**에 달렸다 — 전체 빌드면 vault walk 순서,
  // 앱의 증분 패치면 바뀐 노트가 옮겨진 순서다.
  //
  // 그래서 **같은 질의가 재색인 전후로 다른 순서**를 냈다(실측: `backlinks_of` 9건이 같은
  // 집합인데 순서만 뒤바뀌었다). 순서만 바뀌는 게 아니다 — 아래에서 `cap`으로 자르므로
  // **어느 것이 남는지가 달라진다.** `{doc_kind:"solution", limit:10}`처럼 넓은 facet에서는
  // 매번 다른 10건을 받는다는 뜻이다.
  //
  // 구조 질의에는 점수가 없어(`rel`이 `null`) 순서를 줄 다른 신호가 없다. 경로 오름차순은
  // 재현되고, 디렉터리로 묶이고, 설명할 수 있다 — facet 목록이 (건수, 이름)으로 정렬하는
  // 것과 같은 이유다.
  // 시간축은 요청됐을 때만 만든다 — `mtime`은 vault walk를 한 번 더 쓰기 때문이다
  // (`checkStale`이 하는 walk를 재사용하지만, 아무도 안 물으면 그것도 안 한다).
  const wantsTime = since !== undefined || sort === "recent";
  const timeOf: TimeOf = wantsTime ? timeSource(st, axis) : () => null;
  let cutoff: number | null = null;
  if (since !== undefined) {
    try {
      cutoff = parseSince(since, nowMs);
    } catch (e) {
      if (e instanceof SinceError) {
        throw new LapisError(
          "no_criteria",
          e.message,
          "기간(7d · 24h · 2w) 또는 날짜(YYYY-MM-DD)",
        );
      }
      throw e;
    }
  }

  /** 시간 필터 + 정렬을 후보 목록에 적용한다. **자르기 전에** 해야 의미가 있다. */
  const applyTime = <T extends { path: string }>(rowsIn: T[], scored: boolean): T[] => {
    let out = rowsIn;
    if (cutoff !== null) {
      const part = partitionSince(out, cutoff, timeOf);
      out = part.kept;
      // ⚠️ 자른 건수를 **남긴다.** 조용히 줄이면 `--by date`로 물었을 때 날짜를 안 적은
      // 노트가 사라진 이유를 아무도 모른다.
      used.push({
        name: "since",
        axis,
        cutoff_ms: cutoff,
        matched: out.length,
        dropped_older: part.droppedOlder,
        dropped_no_time: part.droppedNoTime,
      });
    }
    if (sort === "recent") return sortRecent(out, timeOf);
    if (sort === "path") return sortPath(out);
    // 기본은 지금까지의 동작 — 점수가 있으면 점수순(호출부가 이미 정렬해 넘긴다),
    // 없으면 경로순.
    return scored ? out : sortPath(out);
  };

  const poolLive = applyTime(
    pool === null
      ? []
      : [...pool]
          .filter((abs) => !excluded(st.rel(abs), ex))
          .map((abs) => ({ path: abs })),
    false,
  ).map((r) => r.path);

  // BM25 결과에도 같은 필터·정렬을 건다. `applyTime`이 `used`에 두 번 기록하지 않도록
  // 구조 쪽에서 이미 기록했으면 여기선 필터만 다시 적용한다(같은 cutoff·같은 축이다).
  if (cutoff !== null && ranked.length > 0) {
    ranked = partitionSince(ranked, cutoff, timeOf).kept;
  }
  if (sort === "recent") ranked = sortRecent(ranked, timeOf);
  else if (sort === "path") ranked = sortPath(ranked);
  const structuralTotal = poolLive.length;
  let structuralCount = 0;

  if (pool !== null && text && allow.has("bm25")) {
    // 구조 ∩ BM25를 점수순으로 먼저.
    for (const r of ranked) {
      if (results.length >= cap) break;
      if (!pool.has(r.path) || seen.has(r.path)) continue;
      seen.add(r.path);
      results.push(row(r.path, Number(r.score.toFixed(4)), Number(r.rel.toFixed(4)), ["structural", "bm25"]));
    }
    // 구조엔 있는데 BM25가 못 본 건을 점수 없이 뒤에 붙인다(집합 정보 보존).
    for (const abs of poolLive) {
      if (results.length >= cap) break;
      if (seen.has(abs)) continue;
      seen.add(abs);
      results.push(row(abs, null, null, ["structural"]));
    }
    structuralCount = results.length;
  } else {
    const bmSet = new Set(ranked.map((r) => r.path));
    for (const abs of poolLive) {
      if (results.length >= cap) break;
      seen.add(abs);
      results.push(row(abs, null, null, bmSet.has(abs) ? ["structural", "bm25"] : ["structural"]));
    }
    structuralCount = results.length;
    for (const r of ranked) {
      if (results.length >= cap) break;
      if (seen.has(r.path)) continue;
      seen.add(r.path);
      results.push(row(r.path, Number(r.score.toFixed(4)), Number(r.rel.toFixed(4)), ["bm25"]));
    }
  }

  // **실제로 버린 행이 있을 때만** true. 예전엔 구조 전용 분기가 아무것도 자르지 않은 채
  // `structuralCount > cap`으로 true를 냈다 — 소비자는 "잘렸다"로 읽는데 잘린 게 없었다.
  // 반대로 BM25 전용 질의는 553건 중 10건만 주면서 false였다.
  const truncated = structuralTotal > structuralCount || ranked.some((r) => !seen.has(r.path));

  // 필수 메타를 배열 **앞에** 둔다 — 응답이 잘려도 `used`·`vault`가 살아남게.
  return {
    ...base,
    used,
    ...(resolvedTarget ? { resolved_target: st.rel(resolvedTarget) } : {}),
    returned: results.length,
    structural_count: structuralCount,
    structural_total: structuralTotal,
    truncated,
    results,
  };
}

/** 테스트용 — 상주 상태 초기화. */
export function resetState(): void {
  ST = null;
  BM = null;
}
