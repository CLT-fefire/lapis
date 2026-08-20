/**
 * 풀텍스트 검색 품질 계측 하네스.
 *
 * ## 왜 필요한가
 *
 * "한글 bigram이 짧은 질의에 과민하다"는 지적의 근거가 **일화 3건**뿐이었다:
 * `"멀티 윈도우"` 63점 vs 영문 혼합 1,494점 · 질의 간 점수 스케일 비교 불가(848 vs 73) ·
 * `"태그 체계 변경 이유"`가 범용어에 5,411건 걸림. 이걸로는 **뭘 고쳐야 하는지 못 정한다.**
 * 토크나이저를 바꾸면 `CACHE_VERSION` bump라 되돌리기도 비싸다. 그래서 먼저 잰다.
 *
 * ## 방법 — known-item retrieval (라벨링 없음)
 *
 * 문서마다 **자기 자신이 정답인 질의**를 코퍼스에서 뽑아, 그 문서가 몇 위에 오는지 본다.
 * 사람이 정답표를 만들 필요가 없어 수백 건 규모로 돌릴 수 있다.
 *
 * | 질의 종류 | 뽑는 법 | 재현하려는 상황 |
 * |---|---|---|
 * | `title` | frontmatter `title` 전체 | "제목이 대충 이랬는데" |
 * | `title-short` | title에서 **2어절**만 | 짧은 한글 질의 — **지적의 핵심** |
 * | `body` | 본문에서 가장 긴 줄의 앞 8어절 | "이런 문장이 있었는데" |
 *
 * ⚠️ **한계를 알고 쓴다.** 이건 "기억하는 문서를 다시 찾기"만 잰다. "이 주제 문서 전부"
 * 같은 탐색형 질의는 못 잰다 — 그건 구조 팔(`topic`/`tag`)이 담당하고 판정에서 이미 봤다.
 */

import MiniSearch, { type Options, type SearchOptions } from "minisearch";
import { readFileSync } from "node:fs";
import { FULLTEXT_OPTIONS, type FullTextDoc, unionRank } from "./entry.ts";
import { loadShards, norm, resolveVault, type VaultCache } from "./cache.ts";

export interface EvalCase {
  kind: "title" | "title-short" | "body";
  query: string;
  /** 정답 문서의 절대 경로. */
  target: string;
}

export interface CaseResult extends EvalCase {
  /** 1-based 순위. 상한 밖이면 null. */
  rank: number | null;
  /** 정답의 점수. */
  score: number | null;
  /** 1위 문서의 점수 — 정답과의 격차를 보려고. */
  topScore: number | null;
  /** 이 질의에 걸린 전체 문서 수. 과매칭 지표. */
  matched: number;
  /** 이 질의 한 건의 검색 소요(ms). 인덱스 로드는 제외한 순수 질의 비용. */
  ms: number;
}

export interface EvalSummary {
  variant: string;
  n: number;
  /** 1위로 맞힌 비율. */
  recallAt1: number;
  recallAt5: number;
  recallAt10: number;
  /** 평균 역순위 — 순위 품질을 하나로 요약. 1.0이 완벽. */
  mrr: number;
  /** 질의당 평균 매칭 문서 수. 클수록 과매칭. */
  meanMatched: number;
  /**
   * 질의 지연(ms). ⚠️ **품질 지표와 같은 비중으로 본다.**
   *
   * 2026-08-19에 `AND-1` 단계를 넣을 때 게이트가 R@1·R@10·MRR·결과수뿐이라 **지연이 빠져
   * 있었다**. 네 지표를 전부 통과한 변형이 평균 29→118ms, 32어절 860ms였고, 그걸 손측정으로
   * 발견해 상한 8어절로 되돌렸다. 손측정은 다음 사람에게 남지 않는다 → 하네스가 낸다.
   */
  latency: LatencyStats;
  byKind: Record<string, { n: number; recallAt1: number; mrr: number }>;
}

/** 지연 분포 요약. p95를 본다 — 평균은 병리 케이스를 감춘다(실측: 평균 118ms에 최악 860ms). */
export interface LatencyStats {
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

/**
 * nearest-rank 백분위. 표본이 작아 보간하지 않는다 — 실제 관측값 하나를 고른다.
 * (보간하면 "이 질의가 이만큼 걸렸다"고 지목할 수 없다.)
 */
function percentile(sortedMs: readonly number[], p: number): number {
  if (sortedMs.length === 0) return 0;
  const i = Math.min(sortedMs.length - 1, Math.max(0, Math.ceil(p * sortedMs.length) - 1));
  return sortedMs[i];
}

export function latencyOf(msList: readonly number[]): LatencyStats {
  const sorted = [...msList].sort((a, b) => a - b);
  return {
    meanMs: msList.reduce((a, b) => a + b, 0) / Math.max(1, msList.length),
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

const RANK_LIMIT = 10;

/** frontmatter를 걷어내고 본문만. */
function bodyOf(raw: string): string {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") return raw;
  let i = 1;
  while (i < lines.length && lines[i].trim() !== "---") i++;
  return lines.slice(i + 1).join("\n");
}

function titleOf(raw: string): string | null {
  const m = /^---\n([\s\S]*?)\n---/.exec(raw);
  if (!m) return null;
  const t = /^title:\s*(.+)$/m.exec(m[1]);
  if (!t) return null;
  return t[1].trim().replace(/^["']|["']$/g, "");
}

/** 코드펜스·링크·기호를 걷어낸 "사람이 읽는" 줄만 남긴다. */
function proseLines(body: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const raw of body.split("\n")) {
    const l = raw.trim();
    if (l.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || l.length < 20) continue;
    if (l.startsWith("|") || l.startsWith(">") || /^[#\-*\d.]+\s*$/.test(l)) continue;
    out.push(l.replace(/[`*_[\]()]/g, " ").replace(/\s+/g, " ").trim());
  }
  return out;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean);

/**
 * 평가 케이스 생성. `seed`로 표본을 고정해 변형 간 비교가 같은 질의로 이뤄지게 한다.
 * (`Math.random`을 쓰면 변형마다 다른 질의를 재게 돼 비교가 무의미해진다.)
 */
/**
 * 결정론적 셔플(mulberry32). `seed`가 같으면 같은 순서 → 변형 간 비교가 **같은 표본**으로
 * 이뤄진다. (`Math.random`을 쓰면 비교가 무의미해진다.)
 */
export function deterministicShuffle<T>(items: readonly T[], seed: number): T[] {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * **품질 계측용** 표본 순서. 아카이브(`_memories`)는 제외 — 세션 로그라 title이 거의 없고,
 * 있어도 서로 비슷해 known-item이 성립하지 않는다.
 *
 * ⚠️ **빌드 비용 벤치에는 쓰지 않는다.** 이 vault에서 `_memories`가 **94%**(19,313 중
 * 18,000+)라, 이 함수를 벤치 표본으로 쓰면 코퍼스의 6%만 재고 "전체 환산"이 그만큼
 * 어긋난다. 실제로 `./lapis-bench 3000`이 1,274건만 잡아서 발견했다. 벤치는
 * `deterministicShuffle(vc.infos, …)`로 **전량에서** 뽑는다.
 */
export function shuffledPool(vc: VaultCache, seed: number): VaultCache["infos"] {
  const cut = vc.root.endsWith("/") ? vc.root.length : vc.root.length + 1;
  return deterministicShuffle(
    vc.infos.filter((i) => !norm(i.source_path).slice(cut).startsWith("_memories")),
    seed,
  );
}

/** 평가 케이스 생성 — 문서 1건당 `title` · `title-short` · `body` 3종. */
export function buildCases(vc: VaultCache, sampleSize: number, seed = 12345): EvalCase[] {
  const cases: EvalCase[] = [];
  for (const info of shuffledPool(vc, seed)) {
    if (cases.length >= sampleSize * 3) break;
    const target = info.source_path;
    let raw: string;
    try {
      raw = readFileSync(target, "utf8");
    } catch {
      continue;
    }
    const title = titleOf(raw);
    const prose = proseLines(bodyOf(raw));
    if (!title || prose.length === 0) continue;

    const tw = words(title);
    if (tw.length < 2) continue;
    cases.push({ kind: "title", query: title, target });
    // 짧은 질의 — 지적의 핵심. 제목 가운데 2어절(앞쪽은 문서 종류 접두어가 많다).
    const mid = Math.max(0, Math.floor(tw.length / 2) - 1);
    cases.push({ kind: "title-short", query: tw.slice(mid, mid + 2).join(" "), target });
    // 본문 — 가장 긴 산문 줄의 앞 8어절.
    const longest = prose.reduce((a, b) => (b.length > a.length ? b : a));
    cases.push({ kind: "body", query: words(longest).slice(0, 8).join(" "), target });
  }
  return cases.slice(0, sampleSize * 3);
}

/** 지연 프로브 한 건 — 정답 판정을 하지 않는다(비용만 잰다). */
export interface ProbeQuery {
  /** 어절 수. 결합 사다리의 비용이 여기에 O(n²)로 붙는다. */
  words: number;
  query: string;
}

/**
 * **긴 질의 지연 프로브.** 품질 케이스와 분리해 둔 이유가 있다.
 *
 * `buildCases`가 만드는 질의는 title(대개 2~8어절)과 body **앞 8어절**뿐이다. 즉
 * **하네스 구성상 긴 질의가 아예 생기지 않는다** — 32어절 860ms 병리를 품질 케이스로는
 * 영원히 못 본다. 그걸 잡으려고 별도 집합을 둔다.
 *
 * 품질 표에 섞지 않는다. 섞으면 케이스 수와 종류 분포가 달라져 기록된 기준선
 * (R@1 73.9% 등)과 **비교가 끊긴다**.
 *
 * 한 줄로 어절 수가 안 차면 다음 산문 줄을 이어 붙인다 — 실제로 긴 질의가 들어오는
 * 경로가 "문단 붙여넣기"라서 그쪽이 오히려 실사용에 가깝다.
 */
export function buildLongQueries(
  vc: VaultCache,
  count: number,
  wordCount: number,
  seed = 12345,
): ProbeQuery[] {
  const out: ProbeQuery[] = [];
  for (const info of shuffledPool(vc, seed)) {
    if (out.length >= count) break;
    let raw: string;
    try {
      raw = readFileSync(info.source_path, "utf8");
    } catch {
      continue;
    }
    const prose = proseLines(bodyOf(raw));
    if (prose.length === 0) continue;
    const acc: string[] = [];
    for (const line of prose) {
      acc.push(...words(line));
      if (acc.length >= wordCount) break;
    }
    if (acc.length < wordCount) continue;
    out.push({ words: wordCount, query: acc.slice(0, wordCount).join(" ") });
  }
  return out;
}

export interface Variant {
  name: string;
  options?: Partial<Options<FullTextDoc>>;
  searchOptions?: Partial<SearchOptions>;
}

/**
 * shard JSON을 한 번만 읽고, 변형마다 인덱스를 다시 만든다.
 * ⚠️ `loadJSON`으로는 `tokenize`를 바꾼 재색인이 안 된다(토큰이 이미 박혀 있다) →
 * 토크나이저를 바꾸는 변형은 **원문에서 재색인**해야 한다. 그건 `addAll` 경로다.
 */
export function runVariant(
  index: MiniSearch<FullTextDoc>[],
  cases: EvalCase[],
  name: string,
  searchOptions?: SearchOptions,
): EvalSummary {
  const results: CaseResult[] = [];
  for (const c of cases) {
    const t0 = performance.now();
    const hits = searchOptions ? rankWith(index, c.query, searchOptions) : unionRank(index, c.query, 0);
    const ms = performance.now() - t0;
    const at = hits.findIndex((h) => norm(h.path) === norm(c.target));
    results.push({
      ...c,
      rank: at >= 0 && at < RANK_LIMIT ? at + 1 : null,
      score: at >= 0 ? hits[at].score : null,
      topScore: hits[0]?.score ?? null,
      matched: hits.length,
      ms,
    });
  }
  return summarize(name, results);
}

/** `unionRank`와 같은 union·정렬이지만 `searchOptions`를 주입할 수 있다. */
function rankWith(
  index: MiniSearch<FullTextDoc>[],
  query: string,
  opts: SearchOptions,
): { path: string; score: number }[] {
  const all: { path: string; score: number }[] = [];
  for (const idx of index) {
    for (const r of idx.search(query, opts)) all.push({ path: r.id as string, score: r.score });
  }
  all.sort((a, b) => b.score - a.score);
  return all;
}

export function summarize(variant: string, results: CaseResult[]): EvalSummary {
  const n = results.length;
  const at = (k: number) => results.filter((r) => r.rank !== null && r.rank <= k).length / n;
  const byKind: EvalSummary["byKind"] = {};
  for (const kind of ["title", "title-short", "body"]) {
    const sub = results.filter((r) => r.kind === kind);
    if (sub.length === 0) continue;
    byKind[kind] = {
      n: sub.length,
      recallAt1: sub.filter((r) => r.rank === 1).length / sub.length,
      mrr: sub.reduce((a, r) => a + (r.rank ? 1 / r.rank : 0), 0) / sub.length,
    };
  }
  return {
    variant,
    n,
    recallAt1: at(1),
    recallAt5: at(5),
    recallAt10: at(10),
    mrr: results.reduce((a, r) => a + (r.rank ? 1 / r.rank : 0), 0) / n,
    meanMatched: results.reduce((a, r) => a + r.matched, 0) / n,
    latency: latencyOf(results.map((r) => r.ms)),
    byKind,
  };
}

/** 현재 디스크 캐시를 그대로 읽어 기준선 인덱스를 만든다. */
export function loadLiveIndex(vc: VaultCache): MiniSearch<FullTextDoc>[] {
  return loadShards(vc).map(
    (json) => MiniSearch.loadJSON(json, FULLTEXT_OPTIONS) as MiniSearch<FullTextDoc>,
  );
}

export { resolveVault };
