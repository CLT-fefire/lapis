/**
 * `unionRank`의 AND 우선 + OR 폴백 — 계측으로 정한 동작을 고정한다.
 *
 * 근거(`mcp/searchEval.ts`, 19,225 노트 · 363 케이스):
 *
 * | | R@1 | MRR | 평균 매칭 |
 * |---|---:|---:|---:|
 * | OR(기존) | 66.4% | 0.737 | 10,329 |
 * | AND 단독 | 72.5% | 0.785 | 229 |
 * | **AND+OR 폴백** | **71.1%** | **0.767** | **229** |
 *
 * ⚠️ AND **단독**은 못 쓴다 — 질의에 정답 문서에 없는 단어가 하나만 섞여도 **0건**이 된다
 * (실측 R@1 0.0%). grep도 같은 조건에서 재현율 0%, 99%가 0건이었다. 폴백이 그걸 막는다.
 */

import { describe, expect, it } from "vitest";
import MiniSearch from "minisearch";
import { FULLTEXT_OPTIONS, unionRankDetailed, type FullTextDoc } from "./fullTextOptions";

function index(docs: [string, string][]): MiniSearch<FullTextDoc>[] {
  const ms = new MiniSearch<FullTextDoc>(FULLTEXT_OPTIONS);
  ms.addAll(docs.map(([id, body]) => ({ id, name: id, body })));
  return [ms];
}

const DOCS: [string, string][] = [
  ["a", "멀티 윈도우 구현 계획서"],
  ["b", "멀티 스레드 처리"],
  ["c", "윈도우 크기 조절"],
  ["d", "전혀 무관한 내용"],
];

describe("AND 우선", () => {
  it("모든 단어가 든 문서만 낸다", () => {
    const { hits, combine } = unionRankDetailed(index(DOCS), "멀티 윈도우", 0);
    expect(combine).toBe("AND");
    expect(hits.map((h) => h.path)).toEqual(["a"]);
  });

  it("AND가 걸리면 OR보다 훨씬 좁다", () => {
    const { hits } = unionRankDetailed(index(DOCS), "멀티 윈도우", 0);
    expect(hits.length).toBeLessThan(DOCS.length);
  });
});

describe("OR 폴백", () => {
  // ⚠️ 이게 없으면 무관한 단어 하나에 결과가 0건이 된다(실측 R@1 0.0%).
  it("정답에 없는 단어가 섞이면 OR로 떨어져 결과를 낸다", () => {
    const { hits, combine } = unionRankDetailed(index(DOCS), "멀티 윈도우 고양이", 0);
    expect(combine).toBe("OR");
    expect(hits.map((h) => h.path)).toContain("a");
  });

  it("어느 단어도 없으면 그래도 0건이다 — 폴백이 없는 걸 만들어내진 않는다", () => {
    const { hits, combine } = unionRankDetailed(index(DOCS), "고양이 냉장고", 0);
    expect(combine).toBe("OR");
    expect(hits).toEqual([]);
  });

  it("폴백해도 정답이 상위에 온다", () => {
    const { hits } = unionRankDetailed(index(DOCS), "멀티 윈도우 고양이", 0);
    expect(hits[0].path).toBe("a");
  });
});

describe("limit", () => {
  it("0이면 자르지 않는다", () => {
    expect(unionRankDetailed(index(DOCS), "멀티", 0).hits.length).toBe(2);
  });
  it("양수면 자른다", () => {
    expect(unionRankDetailed(index(DOCS), "멀티", 1).hits.length).toBe(1);
  });
});
