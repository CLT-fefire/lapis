/**
 * `unionRankDetailed`의 4단계 결합 — 계측으로 정한 동작을 고정한다.
 *
 * 근거 ①(2026-08-13, 19,225 노트 · 363 케이스) — 결합 자체:
 *
 * | | R@1 | MRR | 평균 매칭 |
 * |---|---:|---:|---:|
 * | OR 단독 | 66.4% | 0.737 | 10,329 |
 * | AND 단독 | 72.5% | 0.785 | 229 |
 * | **AND+OR 폴백** | **71.1%** | **0.767** | **229** |
 *
 * ⚠️ AND **단독**은 못 쓴다 — 질의에 정답 문서에 없는 단어가 하나만 섞여도 **0건**이 된다
 * (실측 R@1 0.0%). grep도 같은 조건에서 재현율 0%, 99%가 0건이었다. 폴백이 그걸 막는다.
 *
 * 근거 ②(2026-08-19, 19,292 노트 · 360 케이스) — **오염 질의**(무관 단어 1개 삽입)에서
 * AND→OR 이분법이 무너지는 구간:
 *
 * | | R@1 | R@10 | MRR | 평균 매칭 |
 * |---|---:|---:|---:|---:|
 * | AND→OR | 67.2% | 86.9% | 0.741 | **10,346** |
 * | OR 후필터만 | 67.8% | **82.5%** | 0.732 | 226 |
 * | AND→AND-1→OR | **70.3%** | **88.6%** | **0.766** | **6,946** |
 * | AND→AND-1→OR-min (상한 없음) | 70.0% | 86.7% | 0.758 | 199 |
 * | **출하 설정 (AND-1 상한 8어절)** | **68.9%** | **86.4%** | **0.750** | **220** |
 *
 * 마지막 행이 실제로 도는 설정이다. 상한이 R@1을 1.1pt 깎는 대신 오염 질의 지연을
 * 평균 118ms → 36ms로 줄인다(기존 AND→OR가 29ms) — 팔레트는 타이핑 중에 도는 경로다.
 *
 * 중간 두 단계를 **겹쳐야** 정확도와 좁음을 같이 얻는다. 깨끗한 질의는 네 변형 모두
 * 기준선과 동일하다(R@1 73.9% · 매칭 228) — 새 단계는 AND가 0건일 때만 도달한다.
 */

import { describe, expect, it } from "vitest";
import MiniSearch from "minisearch";
import { FULLTEXT_OPTIONS, unionRankDetailed, type FullTextDoc } from "./fullTextOptions";

function index(docs: [string, string][]): MiniSearch<FullTextDoc>[] {
  const ms = new MiniSearch<FullTextDoc>(FULLTEXT_OPTIONS);
  // 제목 없는 노트를 재현한다 — 이 테스트가 보는 것은 결합 사다리지 제목 가중치가 아니다.
  ms.addAll(docs.map(([id, body]) => ({ id, name: id, title: "", body })));
  return [ms];
}

const DOCS: [string, string][] = [
  ["a", "멀티 윈도우 구현 계획서"],
  ["b", "멀티 스레드 처리"],
  ["c", "윈도우 크기 조절"],
  ["d", "전혀 무관한 내용"],
];

/** 같은 질의를 순수 OR로 돌렸을 때의 건수 — "단계가 실제로 좁혔나"의 기준선. */
const plainOr = (docs: [string, string][], query: string) => index(docs)[0].search(query).length;

describe("AND 우선", () => {
  it("모든 단어가 든 문서만 낸다", () => {
    const { hits, combine } = unionRankDetailed(index(DOCS), "멀티 윈도우", 0);
    expect(combine).toBe("AND");
    expect(hits.map((h) => h.path)).toEqual(["a"]);
  });

  it("AND가 걸리면 OR보다 훨씬 좁다", () => {
    const { hits } = unionRankDetailed(index(DOCS), "멀티 윈도우", 0);
    expect(hits.length).toBeLessThan(plainOr(DOCS, "멀티 윈도우"));
  });
});

describe("AND-1 — 단어 하나를 빼고 AND", () => {
  // ⚠️ 이 단계가 없으면 무관한 단어 하나에 결과가 통째로 OR로 떨어진다(실측 평균 10,346건).
  it("정답에 없는 단어가 섞여도 AND-1이 건져낸다", () => {
    const { hits, combine } = unionRankDetailed(index(DOCS), "멀티 윈도우 고양이", 0);
    expect(combine).toBe("AND-1");
    expect(hits.map((h) => h.path)).toEqual(["a"]);
  });

  it("OR로 떨어지는 것보다 좁다", () => {
    const { hits } = unionRankDetailed(index(DOCS), "멀티 윈도우 고양이", 0);
    expect(hits.length).toBeLessThan(plainOr(DOCS, "멀티 윈도우 고양이"));
  });

  // ⚠️ 2어절에 쓰면 하나 뺀 게 1어절이라 **사실상 OR**이 된다.
  // 실측: `멀티 윈도우`가 AND 45건 → AND-1 484건, 순수 OR 486건과 거의 같았다.
  it("2어절 질의에는 쓰지 않는다 — 좁히는 효과가 없기 때문", () => {
    const { combine } = unionRankDetailed(index(DOCS), "멀티 고양이", 0);
    expect(combine).not.toBe("AND-1");
  });

  // ⚠️ 부질의가 n개 × 각 n-1항이라 O(n²)다. 상한 없이 두면 32어절 질의가 860ms(기존 88ms),
  // 오염 질의 평균이 118ms(기존 29ms)까지 간다. 8어절에서 끊는다.
  describe("8어절 상한 — O(n²) 비용", () => {
    const LONG: [string, string][] = [
      ["long", "알파 브라보 찰리 델타 에코 폭스 골프 호텔"],
      ["other", "전혀 무관한 내용"],
    ];

    it("8어절까지는 쓴다", () => {
      const q = "알파 브라보 찰리 델타 에코 폭스 골프 고양이"; // 7개 일치 + 오염 1
      expect(unionRankDetailed(index(LONG), q, 0).combine).toBe("AND-1");
    });

    // 상한이 없으면 이 질의도 AND-1로 잡힌다(8개가 한 문서에 다 있다) — 즉 이 테스트는
    // "잡을 수 있는데 일부러 건너뛴다"를 고정한다. 결과 자체는 OR-min이 같은 문서를 낸다.
    it("9어절부터는 건너뛴다 — 잡을 수 있어도", () => {
      const q = "알파 브라보 찰리 델타 에코 폭스 골프 호텔 고양이"; // 8개 일치 + 오염 1
      const { hits, combine } = unionRankDetailed(index(LONG), q, 0);
      expect(combine).not.toBe("AND-1");
      expect(hits.map((h) => h.path)).toEqual(["long"]);
    });
  });
});

describe("OR-min — OR 결과를 매칭 term 수로 거른다", () => {
  // AND-1도 실패하는 구간(어떤 n-1 조합도 한 문서에 다 들어있지 않다). 순수 OR로 가기 전에
  // "질의 토큰의 60% 이상이 걸린 문서"만 남긴다.
  const LONG: [string, string][] = [
    ["hit", "데이터베이스 마이그레이션 계획"], // 긴 단어 2개가 질의 토큰의 다수를 차지
    ["weak", "우산 보관함"], // 짧은 단어 1개만 걸린다
    ["none", "전혀 무관한 내용"],
  ];
  const Q = "데이터베이스 마이그레이션 고양이 냉장고 우산";

  it("약하게 걸린 문서를 떨어뜨린다", () => {
    const { hits, combine } = unionRankDetailed(index(LONG), Q, 0);
    expect(combine).toBe("OR-min");
    expect(hits.map((h) => h.path)).toEqual(["hit"]);
    expect(hits.length).toBeLessThan(plainOr(LONG, Q));
  });
});

describe("OR — 마지막 수단", () => {
  it("어느 단어도 없으면 그래도 0건이다 — 폴백이 없는 걸 만들어내진 않는다", () => {
    const { hits, combine } = unionRankDetailed(index(DOCS), "고양이 냉장고", 0);
    expect(combine).toBe("OR");
    expect(hits).toEqual([]);
  });

  it("어느 단계로 떨어지든 정답이 상위에 온다", () => {
    for (const q of ["멀티 윈도우", "멀티 윈도우 고양이", "멀티 윈도우 구현 고양이 냉장고"]) {
      expect(unionRankDetailed(index(DOCS), q, 0).hits[0].path).toBe("a");
    }
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

/**
 * `rel` — 질의 내 상대 점수.
 *
 * raw `score`는 질의마다 스케일이 달라(실측 63 vs 1,494) 임계값으로 못 쓴다.
 * 이 테스트가 고정하는 것은 두 가지다: **top-1은 항상 1.0**이고, **순서를 바꾸지 않는다**.
 */
/**
 * rel 검증 전용 픽스처. 위 `DOCS`는 계측으로 고정된 단계 판정용이라 건드리지 않는다.
 * 여기서는 **같은 term을 문서들이 다른 빈도로 나눠 갖게** 해 점수가 벌어지도록 만든다.
 */
const REL_DOCS: [string, string][] = [
  ["r1", "멀티 멀티 멀티 윈도우"],
  ["r2", "멀티 멀티 창"],
  ["r3", "멀티 문서"],
];

describe("rel — 질의 간 비교 가능한 점수축", () => {
  it("top-1의 rel은 1.0이다", () => {
    const { hits } = unionRankDetailed(index(DOCS), "멀티", 0);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].rel).toBe(1);
  });

  it("서로 다른 질의여도 top-1은 똑같이 1.0 — 그래서 임계값을 쓸 수 있다", () => {
    // raw score는 두 질의가 다른 스케일이지만 rel은 같은 축이다.
    const a = unionRankDetailed(index(DOCS), "멀티", 0).hits;
    const b = unionRankDetailed(index(DOCS), "윈도우", 0).hits;
    expect(a[0].rel).toBe(1);
    expect(b[0].rel).toBe(1);
  });

  it("rel은 [0,1] 안에 있고 score와 같은 순서다", () => {
    const { hits } = unionRankDetailed(index(REL_DOCS), "멀티", 0);
    expect(hits.length).toBeGreaterThan(1);
    for (const h of hits) {
      expect(h.rel).toBeGreaterThanOrEqual(0);
      expect(h.rel).toBeLessThanOrEqual(1);
    }
    // 단조 변환이라 순서가 보존된다 — 랭킹 회귀 방지.
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i].rel).toBeLessThanOrEqual(hits[i - 1].rel);
      expect(hits[i].score).toBeLessThanOrEqual(hits[i - 1].score);
    }
  });

  it("rel = score / top-score", () => {
    const { hits } = unionRankDetailed(index(REL_DOCS), "멀티", 0);
    const top = hits[0].score;
    for (const h of hits) expect(h.rel).toBeCloseTo(h.score / top, 10);
  });

  it("limit으로 잘라도 top-1 기준은 그대로다", () => {
    const full = unionRankDetailed(index(REL_DOCS), "멀티", 0).hits;
    const cut = unionRankDetailed(index(REL_DOCS), "멀티", 2).hits;
    expect(full.length).toBe(3);
    expect(cut.length).toBe(2);
    expect(cut[0].rel).toBe(1);
    // 자르기 전후로 같은 문서의 rel이 달라지면 임계값이 limit에 따라 흔들린다.
    expect(cut[1].rel).toBeCloseTo(full[1].rel, 10);
  });

  it("결과가 비면 아무것도 내지 않는다 — 0으로 나누지 않는다", () => {
    const { hits } = unionRankDetailed(index(DOCS), "존재하지않는단어xyz", 0);
    expect(hits.every((h) => Number.isFinite(h.rel))).toBe(true);
  });
});
