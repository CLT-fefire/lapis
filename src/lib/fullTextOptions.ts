/**
 * 풀텍스트 인덱스의 **단일 진실** — MiniSearch 옵션 · shard 모델 · union 랭킹(4단계 결합).
 *
 * 이 파일은 **리프 모듈**이다: `minisearch`와 `koTokenize` 외에 아무것도 import 하지 않는다.
 * 그래서 Web Worker(`fullTextWorker.ts`)와 main thread(`searchIndex.ts`)뿐 아니라
 * **Node 프로세스에서도 그대로 import 된다**.
 *
 * ⚠️ **왜 리프여야 하나** — 지식 질의 MCP가 같은 인덱스를 읽는다. 옵션을 복사하면
 * `searchOptions` 소속이라 `CACHE_VERSION` 보호를 받지 못하고, 어긋나도 에러가 없다.
 * **랭킹만 조용히 달라진다.** 원래 `fullTextWorker.ts`의 비-export const였고
 * 같은 파일 최상위에 `self.onmessage`가 있어 Node import 시
 * `ReferenceError: self is not defined`로 죽었다 — 그래서 복사 외에 방법이 없었다.
 *
 * ⚠️ 토크나이저(`koBigramTokenize`)를 바꾸면 인덱스 토큰 공간이 바뀐다 →
 * `search_cache.rs`의 `CACHE_VERSION` bump 필수.
 */

import MiniSearch, { type Options, type Query, type SearchOptions } from "minisearch";
import { koBigramTokenize, normalizeTerm } from "./koTokenize";

export interface FullTextDoc {
  id: string;
  name: string;
  body: string;
}

/** shard union 랭킹 1건. `path`는 문서 id(= 노트 절대 경로). */
export interface FullTextHit {
  path: string;
  score: number;
  name: string;
}

export const FULLTEXT_OPTIONS: Options<FullTextDoc> = {
  fields: ["name", "body"],
  storeFields: ["name"],
  idField: "id",
  tokenize: koBigramTokenize,
  processTerm: normalizeTerm,
  searchOptions: {
    boost: { name: 3 },
    // 역직렬화(loadJSON) 후에도 쿼리 토큰화·정규화가 인덱스와 일치하도록 명시.
    tokenize: koBigramTokenize,
    processTerm: normalizeTerm,
    // 한글 bigram(2글자)은 prefix/fuzzy 제외(정확 매칭). 영어 단어(>2)만 prefix,
    // fuzzy는 4글자+ 에만 — 짧은 term의 radix tree 확장 폭발·오타 노이즈 억제.
    prefix: (term) => term.length > 2,
    fuzzy: (term) => (term.length > 3 ? 0.15 : false),
    maxFuzzy: 3,
    // 길이 보정 완화. 계측(`mcp/searchEval.ts`)에서 기본값 0.7보다 R@1 +0.6pt.
    bm25: { k: 1.2, b: 0.3, d: 0.5 },
  },
};

/**
 * `combineWith: "AND"` 검색 옵션 — `unionRank`가 1차로 쓴다.
 *
 * 계측 근거(`mcp/searchEval.ts`, 19,225 노트 · 363 케이스):
 *
 * | 결합 | R@1 | R@10 | MRR | 평균 매칭 |
 * |---|---:|---:|---:|---:|
 * | OR(기존) | 66.4% | 88.7% | 0.737 | **10,329** |
 * | AND | **72.5%** | **90.1%** | **0.785** | **229** |
 *
 * 매칭이 코퍼스의 54% → 1.2%로 줄고 정확도가 오른다. ⚠️ **다만 AND 단독은 못 쓴다** —
 * 질의에 정답 문서에 없는 단어가 **하나만** 섞여도 결과가 **0건**이 된다(실측 R@1 0.0%).
 * grep도 똑같이 무너진다(AND 재현율 0%, 99%가 0건). 그래서 `unionRank`가 폴백을 건다.
 */
const AND_OPTIONS: SearchOptions = {
  ...(FULLTEXT_OPTIONS.searchOptions as SearchOptions),
  combineWith: "AND",
};

/**
 * 최대 shard 수. 실제 사용 수는 vault별로 다르다(`decideShardCount`가 결정).
 * worker는 max 길이 배열을 미리 할당하고 미사용 shardId는 `null`로 둔다(null 16개, 영향 없음).
 */
export const MAX_SHARDS = 16;

/**
 * ready된 모든 shard에 질의 → union → score 내림차순 → top-N.
 *
 * shard는 **서로 겹치지 않는 문서 집합**(`fnv32(path) % shardCount`)이라 union에
 * 중복이 없다. 단 **점수는 shard-local IDF로 계산된다** — shard 간 절대 비교는
 * 엄밀하지 않지만, 문서가 균등 분산돼 shard별 코퍼스 통계가 비슷해 실용상 성립한다.
 *
 * @param indexes 미사용 슬롯은 `null`. 그대로 넘겨도 skip된다.
 * @param limit `<= 0`이면 자르지 않는다.
 */
export function unionRank(
  indexes: readonly (MiniSearch<FullTextDoc> | null)[],
  query: string,
  limit: number,
): FullTextHit[] {
  return unionRankDetailed(indexes, query, limit).hits;
}

/**
 * 어느 단계에서 결과가 나왔는지. **MCP 응답 필드다**(`mcp/query.ts`의 `used[].combine`) —
 * 값을 바꾸면 계약이 바뀐다.
 *
 * - `AND` — 질의 단어가 전부 든 문서. 좁고 정확하다.
 * - `AND-1` — 단어 하나를 빼고 AND. 질의에 정답에 없는 단어가 섞였다는 신호.
 * - `OR-min` — OR 결과 중 매칭 term이 임계 이상인 것만. 단어 여럿이 어긋났다.
 * - `OR` — 마지막 수단. 코퍼스를 넓게 긁으므로 결과를 신뢰하기 어렵다.
 */
export type Combine = "AND" | "AND-1" | "OR-min" | "OR";

/**
 * `OR` 폴백에서 요구하는 최소 매칭 term 비율.
 *
 * 계측(2026-08-19, 19,292 노트 · 360 케이스, 오염 질의 = 무관 단어 1개 삽입):
 *
 * | 변형 | R@1 | R@10 | MRR | 평균 매칭 |
 * |---|---:|---:|---:|---:|
 * | AND→OR (기존) | 67.2% | 86.9% | 0.741 | **10,346** |
 * | OR 후필터만 | 67.8% | **82.5%** | 0.732 | 226 |
 * | AND→AND-1→OR | **70.3%** | **88.6%** | **0.766** | **6,946** |
 * | **AND→AND-1→OR-min(.6)** | **70.0%** | 86.7% | 0.758 | **199** |
 * | AND→AND-1→OR-min(.8) | 70.0% | 86.4% | 0.756 | 339 |
 *
 * `.6`을 쓴다 — `.8`과 R@1이 같은데 매칭이 199 vs 339로 더 좁다. 후필터 단독은 R@10을
 * 4.4pt 깎고, `AND-1` 단독은 매칭을 못 줄인다. **둘을 겹쳐야 양쪽을 얻는다.**
 *
 * ⚠️ 위 표는 `AND1_MAX_WORDS` **상한을 넣기 전** 측정이다. 실제 출하 설정(상한 8)은
 * 오염 질의 **R@1 68.9% · 매칭 220**이다 — 상한이 품질을 1.1pt 깎는 대신 지연을 1/4로 줄인다.
 *
 * ⚠️ 깨끗한 질의는 네 변형 모두 **기준선과 완전히 동일**하다(R@1 73.9% · 매칭 228) —
 * 새 단계는 AND가 0건일 때만 도달하므로 주 경로를 건드리지 않는다. 상한을 넣어도 그대로다.
 */
const OR_MIN_RATIO = 0.6;

/**
 * `AND-1`을 시도할 **최대 어절 수**. 넘으면 건너뛰고 `OR-min`으로 간다.
 *
 * `partialAndQuery`가 O(n²)이라 긴 질의에서 비용이 폭발한다. 실측(오염 질의 180건, 19,292 노트):
 *
 * | 상한 | 평균 | p95 | 32어절 병리 | R@1 | 평균 매칭 |
 * |---|---:|---:|---:|---:|---:|
 * | 기존 AND→OR | 29ms | 82ms | 88ms | 66.7% | 10,682 |
 * | 없음 | **118ms** | **356ms** | **860ms** | **71.1%** | 265 |
 * | 10 | 86ms | 298ms | — | 70.6% | 266 |
 * | **8** | **36ms** | **118ms** | **85ms** | **69.4%** | 290 |
 * | 6 | 30ms | 79ms | — | 69.4% | 290 |
 *
 * `8`을 쓴다 — 지연이 기존 대비 +24%로 돌아오면서 R@1은 여전히 +2.7pt다. 상한을 없애면
 * R@1이 1.7pt 더 오르지만 **4배 느려진다**: 팔레트는 타이핑 중에 도는 경로다(디바운스가
 * 있어도 p95 356ms는 체감된다). `6`과 `8`은 이 표본에서 품질이 같지만, 7~8어절 실질의에
 * 여유를 남긴다.
 *
 * ⚠️ **앱과 MCP에 같은 값을 쓴다.** 소비자별로 다르게 두고 싶어지지만, 이 모듈이 **단일
 * 진실**인 이유가 그 갈라짐이 조용한 랭킹 차이를 만들었기 때문이다(헤더 주석 참조).
 */
const AND1_MAX_WORDS = 8;

/** 질의를 인덱스와 같은 방식으로 토큰화했을 때의 **서로 다른** term 수. */
function queryTermCount(query: string): number {
  const seen = new Set<string>();
  for (const t of koBigramTokenize(query)) {
    const n = normalizeTerm(t);
    if (n) seen.add(n);
  }
  return seen.size;
}

/**
 * 단어 하나씩 뺀 (n-1)-AND들의 OR — MiniSearch 합성 질의.
 *
 * ⚠️ **2어절 질의엔 쓰지 않는다.** 하나 빼면 1어절이라 사실상 OR이 된다
 * (실측: `멀티 윈도우`가 AND 45건 → 이 방식 484건, OR 486건과 거의 같다).
 *
 * ⚠️ **어절 수 상한도 있다** — 부질의가 n개, 각 n-1항이라 **O(n²)**다. 상한 없이 두면
 * 32어절 질의가 **860ms**(기존 88ms), 오염 질의 평균이 **118ms**(기존 29ms)로 4배가 된다.
 * 호출부가 `AND1_MAX_WORDS`를 지킨다.
 */
function partialAndQuery(words: readonly string[]): Query {
  return {
    combineWith: "OR",
    queries: words.map((_, i) => ({
      combineWith: "AND",
      queries: words.filter((_, j) => j !== i),
    })),
  };
}

/**
 * `unionRank` + 어느 단계에서 나왔는지. 소비자가 "왜 이렇게 많이/적게 나왔나"를 알 수 있게.
 *
 * **4단계로 좁은 쪽부터 시도하고, 결과가 나온 첫 단계에서 멈춘다.**
 *
 * 1. `AND` — 전부 든 문서.
 * 2. `AND-1` — 3~8어절일 때만. 단어 하나를 빼고 AND(합성 질의).
 * 3. `OR-min` — OR 결과를 매칭 term 수로 걸러낸다.
 * 4. `OR` — 그래도 없으면 넓게.
 *
 * 원래는 1·4 이분법이었다. AND는 단어 하나만 어긋나도 0건이 되고(위 표), 그러면 통째로
 * OR로 떨어져 코퍼스의 절반(10,346건)을 긁어왔다. **절반쯤 기억하는 제목을 치는 건 예외가
 * 아니라 기본 사용 패턴인데 그 경로가 가장 나빴다.** 중간 두 단계가 그 구간을 메운다 —
 * 실측 도달 분포(오염 질의, 출하 설정): `AND` 1% · `AND-1` 23% · `OR-min` 71% · `OR` 5%.
 */
export function unionRankDetailed(
  indexes: readonly (MiniSearch<FullTextDoc> | null)[],
  query: string,
  limit: number,
): { hits: FullTextHit[]; combine: Combine } {
  /** 매칭 term 수(`nMatched`)를 함께 보존한다 — `OR-min` 단계가 그걸로 걸러낸다. */
  const run = (q: Query, opts?: SearchOptions): (FullTextHit & { nMatched: number })[] => {
    const combined: (FullTextHit & { nMatched: number })[] = [];
    for (const idx of indexes) {
      if (!idx) continue;
      for (const r of idx.search(q, opts)) {
        combined.push({
          path: r.id as string,
          score: r.score,
          name: (r as unknown as { name: string }).name,
          nMatched: Object.keys(r.match ?? {}).length,
        });
      }
    }
    combined.sort((a, b) => b.score - a.score);
    return combined;
  };

  const cut = (hits: FullTextHit[], combine: Combine) => ({
    hits: limit > 0 ? hits.slice(0, limit) : hits,
    combine,
  });

  const strict = run(query, AND_OPTIONS);
  if (strict.length > 0) return cut(strict, "AND");

  const words = query.split(/\s+/).filter(Boolean);
  if (words.length >= 3 && words.length <= AND1_MAX_WORDS) {
    const partial = run(partialAndQuery(words), AND_OPTIONS);
    if (partial.length > 0) return cut(partial, "AND-1");
  }

  const loose = run(query);
  const need = Math.max(1, Math.ceil(queryTermCount(query) * OR_MIN_RATIO));
  const filtered = loose.filter((h) => h.nMatched >= need);
  return filtered.length > 0 ? cut(filtered, "OR-min") : cut(loose, "OR");
}
