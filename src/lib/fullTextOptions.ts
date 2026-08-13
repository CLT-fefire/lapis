/**
 * 풀텍스트 인덱스의 **단일 진실** — MiniSearch 옵션 · shard 모델 · union 랭킹.
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

import MiniSearch, { type Options, type SearchOptions } from "minisearch";
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
 * `unionRank` + 어느 결합을 썼는지. 소비자가 "왜 이렇게 많이/적게 나왔나"를 알 수 있게.
 *
 * **AND 먼저, 0건이면 OR로 폴백**한다. AND는 정확하지만 단어 하나만 어긋나도 0건이
 * 되고(위 표), OR은 코퍼스의 절반을 긁어온다. 둘의 좋은 쪽만 취한다 — 질의가 정확하면
 * 좁고 정확한 결과, 어긋나면 최소한 뭔가는 준다.
 */
export function unionRankDetailed(
  indexes: readonly (MiniSearch<FullTextDoc> | null)[],
  query: string,
  limit: number,
): { hits: FullTextHit[]; combine: "AND" | "OR" } {
  const run = (opts?: SearchOptions): FullTextHit[] => {
    const combined: FullTextHit[] = [];
    for (const idx of indexes) {
      if (!idx) continue;
      for (const r of idx.search(query, opts)) {
        combined.push({
          path: r.id as string,
          score: r.score,
          name: (r as unknown as { name: string }).name,
        });
      }
    }
    combined.sort((a, b) => b.score - a.score);
    return combined;
  };

  let hits = run(AND_OPTIONS);
  let combine: "AND" | "OR" = "AND";
  if (hits.length === 0) {
    hits = run();
    combine = "OR";
  }
  return { hits: limit > 0 ? hits.slice(0, limit) : hits, combine };
}
