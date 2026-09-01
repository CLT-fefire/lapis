/**
 * 응답 크기 상한 — 리뷰가 잡은 최대 결함의 회귀 방지.
 *
 * "구조 결과는 잘리지 않는다"를 pool 전건 적재로 구현했더니 `limit`이 무의미해지고
 * 응답이 무제한이 됐다. 실측으로 `{doc_kind:"solution", limit:10}`이 **130행 38 KB**,
 * `{tag:"tech", limit:10}`이 **284행 72 KB**였다 — grep 베이스라인이 4문항 45 KB였으니
 * 단일 질의가 그보다 컸다. 바이트를 줄이려고 만든 도구가 그 반대를 했다.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanupFixtures, makeFixture, type FixtureNote } from "../core/fixture.ts";
import { lapisQuery, isAudit, resetState } from "../core/query.ts";

afterEach(() => {
  delete process.env.LAPIS_CACHE_DIR;
  resetState();
  cleanupFixtures();
});

/** 넓은 facet 200건 — 실제 vault의 `doc_kind:"solution"`(130) · `tag:"tech"`(284)를 모사. */
const MANY: FixtureNote[] = Array.from({ length: 200 }, (_, i) => ({
  rel: `proj/solutions/note-${i}.md`,
  doc_kind: "solution",
  topic: "bulk",
  tags: ["tech/x"],
  body: `본문 ${i}. `.repeat(40),
}));

function setupMany() {
  const fx = makeFixture(MANY);
  process.env.LAPIS_CACHE_DIR = fx.cacheDir;
  resetState();
  return fx;
}

describe("응답 크기 상한", () => {
  it.each([10, 50])("넓은 구조 질의가 limit=%i을 지킨다", (limit) => {
    setupMany();
    const r = lapisQuery({ doc_kind: "solution", limit });
    if (isAudit(r) || r.list !== undefined) throw new Error("검색 응답을 기대했다");
    expect(r.returned).toBe(limit);
    expect(r.structural_total).toBe(200); // 집합 크기는 따로 알려준다
    expect(r.truncated).toBe(true);
    // 상한 50에서도 30 KB 미만 — 예전엔 limit과 무관하게 200행이 실렸다.
    expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThan(30 * 1024);
  });

  it("tag prefix 질의도 같은 상한을 받는다", () => {
    setupMany();
    const r = lapisQuery({ tag: "tech", limit: 10 });
    if (isAudit(r) || r.list !== undefined) throw new Error("검색 응답을 기대했다");
    expect(r.returned).toBe(10);
    expect(r.structural_total).toBe(200);
  });

  it("list 열거도 limit을 지킨다", () => {
    setupMany();
    const r = lapisQuery({ list: "topics", limit: 1 });
    if (isAudit(r) || r.list === undefined) throw new Error("list 응답을 기대했다");
    expect(r.returned).toBe(1);
  });
});
