/**
 * `lapis_query` 테스트 — 전부 픽스처 기반(라이브 앱 캐시에 의존하지 않는다).
 *
 * 여기 있는 단정문의 절반은 **스파이크·판정에서 실제로 틀렸던 것**을 고정한다.
 * 각 describe 블록의 주석이 어떤 결함인지 밝힌다.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addSiblingMeta, makeFixture, SAMPLE_NOTES, type Fixture } from "./fixture.ts";
import {
  lapisQuery,
  resetState,
  type FacetListResponse,
  type QueryArgs,
  type SearchResponse,
} from "./query.ts";
import { LapisError } from "./cache.ts";

let fx: Fixture;

function setup(opts: Parameters<typeof makeFixture>[1] = {}, notes = SAMPLE_NOTES) {
  fx = makeFixture(notes, opts);
  process.env.LAPIS_CACHE_DIR = fx.cacheDir;
  resetState();
  return fx;
}

beforeEach(() => setup());
afterEach(() => {
  delete process.env.LAPIS_CACHE_DIR;
  resetState();
});

/** 검색 응답으로 좁힌다 — `list` 응답이 오면 테스트가 그 자리에서 실패해야 한다. */
function search(args: QueryArgs): SearchResponse {
  const r = lapisQuery(args);
  if (r.list !== undefined) throw new Error(`검색 응답을 기대했는데 list=${r.list}`);
  return r;
}

/** facet 열거 응답으로 좁힌다. */
function facets(args: QueryArgs): FacetListResponse {
  const r = lapisQuery(args);
  if (r.list === undefined) throw new Error("list 응답을 기대했다");
  return r;
}

const paths = (r: SearchResponse) => r.results.map((x) => x.path);

describe("인자 검증", () => {
  it("조건이 하나도 없으면 no_criteria", () => {
    expect(() => lapisQuery({})).toThrowError(
      expect.objectContaining({ kind: "no_criteria" }),
    );
  });

  // sources가 준 인자를 전부 잘라내면 **빈 성공**을 내던 구멍. 0건과 구별이 안 됐다.
  it("sources가 준 인자를 전부 잘라내면 빈 성공 대신 실패", () => {
    expect(() => lapisQuery({ text: "태그", sources: ["structural"] })).toThrowError(
      expect.objectContaining({ kind: "no_criteria" }),
    );
  });

  it("limit은 1~50으로 클램프된다", () => {
    expect(search({ doc_kind: "solution", limit: 999 }).returned).toBeLessThanOrEqual(50);
    expect(search({ doc_kind: "adr", limit: 0 }).returned).toBeGreaterThan(0);
  });
});

describe("backlinks_of — 본문 링크 ∪ frontmatter relations", () => {
  // 스파이크 초기엔 `linkIndex.backlinks`만 봤다. 그건 **본문 wikilink 전용**이라
  // `related`/`amends`/`superseded_by`로만 걸린 문서를 통째로 놓친다(실측 8건 중 3건).
  it("frontmatter로만 참조한 문서도 포함한다", () => {
    const r = search({ backlinks_of: "proj/adr/001-abandoned.md" });
    expect(paths(r)).toContain("proj/adr/002-revived.md"); // 본문 + amends
    expect(paths(r)).toContain("proj/plans/rework.md"); // superseded_by 뿐
  });

  it("via로 근거를 구분해 낸다", () => {
    const r = search({ backlinks_of: "proj/adr/001-abandoned.md" });
    const rework = r.results.find((x) => x.path === "proj/plans/rework.md");
    expect(rework?.via).toEqual(["fm:superseded_by"]);
    const revived = r.results.find((x) => x.path === "proj/adr/002-revived.md");
    expect(revived?.via).toContain("link");
  });

  it("used가 body/frontmatter 건수를 분리해 보고한다", () => {
    const r = search({ backlinks_of: "proj/adr/001-abandoned.md" });
    const refs = r.used.find((u) => u.name === "refs")!;
    expect(refs.body).toBe(1);
    expect(refs.frontmatter).toBe(2);
  });

  // grep이 접두 충돌(`ADR-001` → `ADR-0010`)로 오탐을 내던 자리.
  it("노트 이름만으로도 해소되고 resolved_target을 되울린다", () => {
    const r = search({ backlinks_of: "001-abandoned" });
    expect(r.resolved_target).toBe("proj/adr/001-abandoned.md");
    // 참조 문서는 2건: 002-revived(본문 + amends) · rework(superseded_by만).
    // 경로로 물었을 때와 **같은 결과**여야 한다 — 그게 이 테스트의 요지다.
    expect(r.returned).toBe(2);
    expect(paths(r)).toEqual(paths(search({ backlinks_of: "proj/adr/001-abandoned.md" })));
  });

  it("인덱스에 없는 경로는 path_not_indexed — 0건과 구별한다", () => {
    expect(() => lapisQuery({ backlinks_of: "없는/문서.md" })).toThrowError(
      expect.objectContaining({ kind: "path_not_indexed" }),
    );
  });
});

describe("병합 규칙 — 구조는 집합이거나 필터", () => {
  // ⚠️ 이게 판정에서 잡힌 최대 결함이다. "구조는 언제나 안 자른다"로 두면 넓은 facet이
  // 랭킹 없이 앞을 다 채워 정답이 뒤로 밀린다(실측 130건 중 #128 → 수정 후 #2).
  it("구조 + text면 교집합을 BM25 점수로 정렬한다", () => {
    const r = search({ text: "태그 체계", doc_kind: "solution" });
    expect(r.results[0].path).toBe("proj/solutions/tag-drift.md");
    expect(r.results[0].score).toBeGreaterThan(0);
    expect(r.results[0].sources).toEqual(["structural", "bm25"]);
  });

  it("구조만 주면 점수 없이 전건", () => {
    const r = search({ doc_kind: "adr" });
    expect(r.returned).toBe(2);
    expect(r.results.every((x) => x.score === null)).toBe(true);
  });

  // 구조 집합이 상한을 넘어도 자르지 않는다 — 잘림을 모르면 "인덱스에 없다"와 혼동한다.
  it("구조 집합은 상한을 넘어도 자르지 않고 truncated로 알린다", () => {
    const r = search({ doc_kind: "adr", limit: 1 });
    expect(r.returned).toBe(2);
    expect(r.truncated).toBe(true);
  });
});

describe("exclude — 문자열 prefix", () => {
  // ⚠️ 디렉터리 경계(`x + "/"`)로 맞췄더니 세그먼트 중간에서 끊는 prefix가 **조용히
  // no-op**이 됐다. 판정 세션이 잡았고, 그 탓에 자기오염 제외가 안 걸린 채 판정이 돌았다.
  it("세그먼트 중간에서 끊는 prefix도 실제로 걸러낸다", () => {
    const r = search({ doc_kind: "adr", exclude: ["proj/adr/001-aban"] });
    expect(paths(r)).not.toContain("proj/adr/001-abandoned.md");
    expect(paths(r)).toContain("proj/adr/002-revived.md");
  });

  it("디렉터리 이름도 그대로 걸러진다", () => {
    const r = search({ text: "태그", include_archive: true, exclude: ["_memories"] });
    expect(paths(r).some((p) => p.startsWith("_memories"))).toBe(false);
  });
});

describe("_memories 기본 제외", () => {
  // vault의 94%를 차지해 BM25 상위를 익사시킨다(판정 세션의 최대 마찰).
  it("기본으로 아카이브를 뺀다", () => {
    const r = search({ text: "태그 체계" });
    expect(paths(r).some((p) => p.startsWith("_memories"))).toBe(false);
    expect(r.excluded).toContain("_memories");
  });

  it("include_archive로 되돌릴 수 있다", () => {
    const r = search({ text: "태그 체계", include_archive: true });
    expect(paths(r).some((p) => p.startsWith("_memories"))).toBe(true);
  });
});

describe("facet 열거", () => {
  // 판정이 지목한 최대 마찰 — "전부"의 완결성은 topic 정확일치가 냈는데, 그 값을
  // 알아낼 경로가 응답에 없어서 판정 세션은 우연히 알았다.
  it("topics를 빈도순으로 낸다", () => {
    const r = facets({ list: "topics" });
    expect(r.values[0]).toEqual({ value: "graph", count: 3 });
    expect(r.values.map((v) => v.value)).toContain("tag-system");
  });

  it("tags는 nested 값을 그대로 낸다", () => {
    const r = facets({ list: "tags" });
    expect(r.values.map((v) => v.value)).toContain("issue/silent-failure");
  });

  it("doc_kinds도 낸다", () => {
    const r = facets({ list: "doc_kinds" });
    expect(r.values.map((v) => v.value)).toEqual(
      expect.arrayContaining(["adr", "solution", "plan"]),
    );
  });
});

describe("tag — nested prefix", () => {
  it("prefix를 주면 하위 전부", () => {
    expect(search({ tag: "issue" }).returned).toBe(1);
    expect(search({ tag: "issue/silent-failure" }).returned).toBe(1);
    expect(search({ tag: "tech" }).returned).toBe(1);
  });
});

describe("스니펫", () => {
  // 경로만 돌려주면 소비자가 결국 파일을 읽고, 그게 grep 팔이 바이트를 쓰는 지점이다.
  it("frontmatter를 건너뛰고 매칭 줄을 낸다", () => {
    const r = search({ text: "아무 데도 안 들어간다" });
    const hit = r.results.find((x) => x.path === "proj/solutions/tag-drift.md")!;
    expect(hit.snippet).toContain("아무 데도 안 들어간다");
    expect(hit.snippet).not.toContain("doc_kind:");
  });
});

describe("shard 결손·skew는 fail-closed", () => {
  // 부분 인덱스로 검색하면 "검색했는데 안 나온다"가 되고, 소비자는 "없다"로 읽는다.
  it("shard fingerprint가 meta와 다르면 실패", () => {
    setup({ shardCount: 2, corruptShardFingerprint: 1 });
    expect(() => lapisQuery({ text: "태그" })).toThrowError(
      expect.objectContaining({ kind: "shard_incomplete" }),
    );
  });

  it("shard_id가 어긋나면 실패", () => {
    setup({ shardCount: 2, corruptShardId: 0 });
    expect(() => lapisQuery({ text: "태그" })).toThrowError(
      expect.objectContaining({ kind: "shard_incomplete" }),
    );
  });

  it("shard 파일이 부족하면 실패", () => {
    setup({ shardCount: 3, writeShards: 1 });
    expect(() => lapisQuery({ text: "태그" })).toThrowError(
      expect.objectContaining({ kind: "shard_incomplete" }),
    );
  });

  // 앱이 풀텍스트를 저장 못 한 스냅샷 — meta는 유효하니 구조 팔은 살아야 한다.
  it("shard_count=0이면 풀텍스트만 실패하고 구조 팔은 동작한다", () => {
    setup({ shardCount: 0, writeShards: 0 });
    expect(() => lapisQuery({ text: "태그" })).toThrowError(
      expect.objectContaining({ kind: "shard_incomplete" }),
    );
    expect(search({ doc_kind: "adr" }).returned).toBe(2);
  });
});

describe("vault 해소", () => {
  // ⚠️ 스파이크는 "link_infos 최대"를 폴백으로 썼다. v7 bump 후 최대 후보가 skew로
  // 탈락하자 **에러 없이 다른 vault의 작은 캐시를 검색**했다(returned=0).
  it("meta가 구버전이면 조용히 넘어가지 않고 version_skew", () => {
    setup({ metaVersion: 6 });
    expect(() => lapisQuery({ doc_kind: "adr" })).toThrowError(
      expect.objectContaining({ kind: "version_skew" }),
    );
  });

  it("없는 vault를 지정하면 vault_not_found", () => {
    expect(() => lapisQuery({ doc_kind: "adr", vault: "/없는/경로" })).toThrowError(
      expect.objectContaining({ kind: "vault_not_found" }),
    );
  });

  it("root를 source_path 공통 접두로 산출한다", () => {
    expect(search({ doc_kind: "adr" }).vault).toBe(fx.vaultRoot);
  });

  // ⚠️ 처음엔 "skew 후보가 하나라도 있으면 실패"로 막았는데, 그러면 **다른 vault의 작은
  // 잔재 하나가 정상 vault 질의를 전부 세운다**. 실제로 그랬다 — 35노트·1노트짜리 v6
  // 잔재가 19,222노트 vault를 막았다. 크기를 보고 판단해야 한다.
  it("작은 구버전 잔재는 더 큰 정상 vault를 막지 않는다", () => {
    addSiblingMeta(fx, { key: "leftover00000001", version: 6, noteCount: 2, vaultRoot: "/other/tiny" });
    resetState();
    expect(search({ doc_kind: "adr" }).vault).toBe(fx.vaultRoot);
  });

  // 반대 방향 — 더 큰 vault가 skew로 빠진 걸 모르고 작은 걸 검색하면 조용히 엉뚱한 답이다.
  it("더 큰 구버전 캐시가 있으면 조용히 작은 걸 고르지 않고 실패", () => {
    addSiblingMeta(fx, { key: "bigskew000000001", version: 6, noteCount: 9999, vaultRoot: "/other/big" });
    resetState();
    expect(() => lapisQuery({ doc_kind: "adr" })).toThrowError(
      expect.objectContaining({ kind: "version_skew" }),
    );
  });

  it("vault를 명시하면 큰 구버전 잔재가 있어도 그 vault를 쓴다", () => {
    addSiblingMeta(fx, { key: "bigskew000000001", version: 6, noteCount: 9999, vaultRoot: "/other/big" });
    resetState();
    expect(search({ doc_kind: "adr", vault: fx.vaultRoot }).vault).toBe(fx.vaultRoot);
  });

  it("요청한 vault가 구버전이면 그 사실을 정확히 말한다", () => {
    addSiblingMeta(fx, { key: "oldone0000000001", version: 6, noteCount: 3, vaultRoot: "/other/old" });
    resetState();
    try {
      lapisQuery({ doc_kind: "adr", vault: "/other/old" });
      expect.unreachable();
    } catch (e) {
      const err = e as LapisError;
      expect(err.kind).toBe("version_skew");
      expect(err.message).toContain("/other/old");
    }
  });
});

describe("오류 직렬화", () => {
  it("kind·message·remedy를 전부 낸다", () => {
    try {
      lapisQuery({});
      expect.unreachable();
    } catch (e) {
      const j = (e as LapisError).toJSON();
      expect(j.error.kind).toBe("no_criteria");
      expect(j.error.remedy).toBeTruthy();
    }
  });
});
