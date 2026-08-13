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

import MiniSearch, { type Options } from "minisearch";
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
  },
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
  const combined: FullTextHit[] = [];
  for (const idx of indexes) {
    if (!idx) continue;
    for (const r of idx.search(query)) {
      combined.push({
        path: r.id as string,
        score: r.score,
        name: (r as unknown as { name: string }).name,
      });
    }
  }
  combined.sort((a, b) => b.score - a.score);
  return limit > 0 ? combined.slice(0, limit) : combined;
}
