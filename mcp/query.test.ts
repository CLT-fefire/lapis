/**
 * `lapis_query` 테스트 — 전부 픽스처 기반(라이브 앱 캐시에 의존하지 않는다).
 *
 * 여기 있는 단정문의 절반은 **스파이크·판정에서 실제로 틀렸던 것**을 고정한다.
 * 각 describe 블록의 주석이 어떤 결함인지 밝힌다.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import {
  addSiblingMeta,
  cleanupFixtures,
  makeFixture,
  SAMPLE_NOTES,
  type Fixture,
} from "./fixture.ts";
import {
  lapisQuery,
  resetState,
  type FacetListResponse,
  type QueryArgs,
  type SearchResponse,
} from "./query.ts";
import { CACHE_VERSION, LapisError } from "./cache.ts";

let fx: Fixture;
/** 테스트가 makeFixture를 안 거치고 직접 만든 임시 디렉터리. */
const scratch: string[] = [];

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
  // 안 하면 매 실행마다 $TMPDIR에 픽스처 디렉터리가 쌓인다(실측 470여 개 누적).
  cleanupFixtures();
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
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
  });

  // ⚠️ `Math.trunc(limit) || DEFAULT_LIMIT`가 falsy-zero에 걸려 0을 **10으로** 바꿨다.
  // 명시적으로 준 값이 조용히 다른 값이 되면 응답 크기를 통제하려는 호출자가 원인을 못 찾는다.
  it("limit:0은 기본값 10이 아니라 하한 1로 간다", () => {
    expect(search({ doc_kind: "adr", limit: 0 }).returned).toBe(1);
  });

  it("limit이 NaN이면 기본값으로 떨어진다", () => {
    expect(search({ doc_kind: "adr", limit: Number.NaN }).returned).toBe(2);
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

  // ⚠️ 예전엔 "구조는 안 자른다"를 pool 전건 적재로 구현해 `limit`이 무의미했다.
  // 실측으로 `{doc_kind:"solution", limit:10}`이 130행 38 KB를 냈다 — grep 베이스라인
  // 4문항 전체가 45 KB였으니 단일 질의가 그보다 컸다.
  it("구조 집합도 limit을 지키고, 남은 건 structural_total로 알린다", () => {
    const r = search({ doc_kind: "adr", limit: 1 });
    expect(r.returned).toBe(1); // ← 상한 준수
    expect(r.structural_total).toBe(2); // ← 집합 크기는 따로 통보
    expect(r.truncated).toBe(true);
  });

  it("상한 안에 다 들어가면 truncated는 false다", () => {
    const r = search({ doc_kind: "adr", limit: 10 });
    expect(r.returned).toBe(2);
    expect(r.structural_total).toBe(2);
    expect(r.truncated).toBe(false);
  });

  // 예전엔 BM25 전용 질의가 수백 건 중 10건만 주면서도 truncated=false였다.
  it("BM25 전용 질의도 버린 게 있으면 truncated다", () => {
    const r = search({ text: "태그", limit: 1, include_archive: true });
    expect(r.returned).toBe(1);
    expect(r.truncated).toBe(true);
  });

  it("구조+text 교집합도 limit을 지킨다", () => {
    const r = search({ text: "태그", doc_kind: "solution", limit: 1, include_archive: true });
    expect(r.returned).toBe(1);
    expect(r.structural_total).toBe(2);
    expect(r.truncated).toBe(true);
  });
});

describe("지연 로드 보고", () => {
  // ⚠️ `loadBm25` **뒤에** `BM !== null`을 읽어서 항상 true였다. 실측으로 이미 로드된
  // 2·3회차도 true였고, 그 값으로 "지연 로드를 확인했다"고 착각하게 만들었다.
  it("lazy_loaded_now는 처음 로드한 호출에서만 true", () => {
    const first = search({ text: "태그", include_archive: true });
    const second = search({ text: "vitest", include_archive: true });
    const bm = (r: SearchResponse) => r.used.find((u) => u.name === "bm25")!;
    expect(bm(first).lazy_loaded_now).toBe(true);
    expect(bm(second).lazy_loaded_now).toBe(false);
  });

  it("구조 전용 질의는 BM25를 아예 로드하지 않는다", () => {
    const r = search({ doc_kind: "adr" });
    expect(r.used.some((u) => u.name === "bm25")).toBe(false);
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

// ── 리뷰가 지목한 미검증 오류 kind 4종 + 격리 동작 ─────────────────────
// `stale`은 모든 질의를 막는 fail-closed 게이트인데 테스트가 0건이었다. 픽스처가 vault
// 파일을 meta보다 **먼저** 쓰기 때문에 이 경로가 한 번도 실행되지 않았다 — 방향이
// 뒤집히는 회귀가 들어와도 전부 통과했을 것이다.
describe("staleness — 보고하되 막지 않는다", () => {
  // ⚠️ 원래는 fail-closed였는데 **실측이 전제를 뒤집었다.** 전제는 "앱이 2초 안에
  // 갱신하니 stale 창이 좁다"였지만, 커밋에 10~20초가 걸리고 살아 있는 vault는 그 사이에도
  // 계속 쓰인다. 2026-08-13 실측에서 **19,202개 중 3개(0.016%)** 가 새로웠고 그 상태로
  // 모든 질의가 실패했다. 0.016%로 도구를 세우는 건 비례하지 않고, 무엇보다
  // **하드 실패 자체가 판단**이다 — 이 서버의 원칙은 "판단하지 않는다"이다.
  it("새로운 노트가 있으면 실패 대신 stale을 실어 보낸다", () => {
    const fixture = setup();
    const future = new Date(Date.now() + 3_600_000);
    utimesSync(nodePath.join(fixture.vaultRoot, "proj/adr/001-abandoned.md"), future, future);
    resetState();
    const r = search({ doc_kind: "adr" });
    expect(r.returned).toBe(2); // ← 막히지 않는다
    expect(r.stale?.newer_count).toBe(1);
    expect(r.stale?.behind_s).toBeGreaterThan(3500);
    expect(r.stale?.sample).toContain("proj/adr/001-abandoned.md");
  });

  it("최신이면 stale 필드 자체가 없다 — 있으면 곧 낡았다는 뜻", () => {
    expect(search({ doc_kind: "adr" }).stale).toBeUndefined();
  });

  it("list 응답에도 실린다", () => {
    const fixture = setup();
    const future = new Date(Date.now() + 3_600_000);
    utimesSync(nodePath.join(fixture.vaultRoot, "proj/adr/001-abandoned.md"), future, future);
    resetState();
    expect(facets({ list: "topics" }).stale?.newer_count).toBe(1);
  });
});

describe("캐시 부재·손상", () => {
  it("캐시 디렉터리가 없으면 cache_absent", () => {
    process.env.LAPIS_CACHE_DIR = nodePath.join(tmpdir(), "lapis-mcp-없는디렉터리-12345");
    resetState();
    expect(() => lapisQuery({ doc_kind: "adr" })).toThrowError(
      expect.objectContaining({ kind: "cache_absent" }),
    );
  });

  it("meta가 하나도 없으면 cache_absent", () => {
    const dir = mkdtempSync(nodePath.join(tmpdir(), "lapis-mcp-empty-"));
    scratch.push(dir);
    process.env.LAPIS_CACHE_DIR = dir;
    resetState();
    expect(() => lapisQuery({ doc_kind: "adr" })).toThrowError(
      expect.objectContaining({ kind: "cache_absent" }),
    );
  });

  // ⚠️ 손상 파일 하나가 **정상 vault 질의를 전부 막았다.** 손상을 version_skew와 같은
  // 통에 넣고 `size: -1`로 표시했더니 크기 비교가 그걸 "더 클 수도 있음"으로 읽었다.
  // 메시지도 "구버전 캐시가 … v-1 -1건"으로 나가 원인을 못 짚었다.
  it("손상된 남의 캐시 1개는 정상 vault를 막지 않는다", () => {
    const fixture = setup();
    writeFileSync(nodePath.join(fixture.cacheDir, "junkkey000000001.meta.json.gz"), "gzip 아님");
    resetState();
    expect(search({ doc_kind: "adr" }).returned).toBe(2);
  });

  it("쓸 수 있는 캐시가 없고 손상만 있으면 corrupt", () => {
    const dir = mkdtempSync(nodePath.join(tmpdir(), "lapis-mcp-corrupt-"));
    scratch.push(dir);
    writeFileSync(nodePath.join(dir, "junkkey000000001.meta.json.gz"), "gzip 아님");
    process.env.LAPIS_CACHE_DIR = dir;
    resetState();
    expect(() => lapisQuery({ doc_kind: "adr" })).toThrowError(
      expect.objectContaining({ kind: "corrupt" }),
    );
  });

  // ⚠️ `statSync`에 try/catch가 없어 생 ENOENT가 `kind:"internal"`로 나갔다.
  it("질의 사이에 meta가 지워지면 internal이 아니라 cache_absent", () => {
    const fixture = setup();
    expect(search({ doc_kind: "adr" }).returned).toBe(2);
    rmSync(nodePath.join(fixture.cacheDir, `${fixture.key}.meta.json.gz`));
    expect(() => lapisQuery({ doc_kind: "adr" })).toThrowError(
      expect.objectContaining({ kind: "cache_absent" }),
    );
  });
});

describe("vault 동률", () => {
  it("같은 크기 캐시가 둘이면 vault_ambiguous", () => {
    const fixture = setup();
    addSiblingMeta(fixture, {
      key: "twinkey000000001",
      // 의도는 **현재 버전의 정상 캐시**다. 리터럴로 박으면 앱이 bump할 때
      // 조용히 skew로 분류돼 이 테스트가 다른 것을 검증하게 된다.
      version: CACHE_VERSION,
      noteCount: SAMPLE_NOTES.length,
      vaultRoot: "/other/twin",
    });
    resetState();
    expect(() => lapisQuery({ doc_kind: "adr" })).toThrowError(
      expect.objectContaining({ kind: "vault_ambiguous" }),
    );
  });

  it("동률이어도 vault를 명시하면 해소된다", () => {
    const fixture = setup();
    addSiblingMeta(fixture, {
      key: "twinkey000000001",
      // 의도는 **현재 버전의 정상 캐시**다. 리터럴로 박으면 앱이 bump할 때
      // 조용히 skew로 분류돼 이 테스트가 다른 것을 검증하게 된다.
      version: CACHE_VERSION,
      noteCount: SAMPLE_NOTES.length,
      vaultRoot: "/other/twin",
    });
    resetState();
    expect(search({ doc_kind: "adr", vault: fixture.vaultRoot }).vault).toBe(fixture.vaultRoot);
  });
});

describe("dev·릴리즈 캐시 분리 (2026-08-13)", () => {
  // 앱이 dev(`com.lapis.dev-dev/`)와 릴리즈(`com.lapis.dev/`)로 캐시를 나눠 쓴다.
  // ⚠️ 그러면 **같은 vault의 meta가 두 개** 존재한다 — 크기가 당연히 같으니 예전 규칙대로면
  // `vault_ambiguous`로 막힌다. 정상 상황에서 도구가 죽는 것이므로 최신을 골라야 한다.
  it("같은 vault가 둘이면 ambiguous가 아니라 최신을 고른다", () => {
    const fixture = setup();
    addSiblingMeta(fixture, {
      key: "devsidecache001",
      // 의도는 **현재 버전의 정상 캐시**다. 리터럴로 박으면 앱이 bump할 때
      // 조용히 skew로 분류돼 이 테스트가 다른 것을 검증하게 된다.
      version: CACHE_VERSION,
      noteCount: SAMPLE_NOTES.length,
      vaultRoot: fixture.vaultRoot, // ← 같은 vault
      ageOffsetMs: 60_000, // 1분 더 최신
    });
    resetState();
    const r = search({ doc_kind: "adr" });
    expect(r.vault).toBe(fixture.vaultRoot);
    // 최신 쪽(sibling)은 doc_kind가 전부 null인 더미라 0건이 나와야 한다 —
    // 즉 "최신을 골랐다"가 결과로 증명된다.
    expect(r.returned).toBe(0);
  });

  it("서로 다른 vault가 동률이면 여전히 ambiguous", () => {
    const fixture = setup();
    addSiblingMeta(fixture, {
      key: "othervault00001",
      // 의도는 **현재 버전의 정상 캐시**다. 리터럴로 박으면 앱이 bump할 때
      // 조용히 skew로 분류돼 이 테스트가 다른 것을 검증하게 된다.
      version: CACHE_VERSION,
      noteCount: SAMPLE_NOTES.length,
      vaultRoot: "/other/place", // ← 다른 vault
    });
    resetState();
    expect(() => lapisQuery({ doc_kind: "adr" })).toThrowError(
      expect.objectContaining({ kind: "vault_ambiguous" }),
    );
  });
});

describe("vault 인자 정규화", () => {
  // ⚠️ 캐시 재사용 판정만 `norm()`을 쓰고 `resolveVault`는 `path.resolve` + 후행 슬래시
  // 제거까지 했다. 그래서 슬래시 하나 차이로 매 호출 전체 재로드 + BM25 8 shard
  // 재로드(실측 1.4초)가 일어났다.
  it("후행 슬래시가 있어도 인덱스를 다시 로드하지 않는다", () => {
    const fixture = setup();
    search({ text: "태그", vault: fixture.vaultRoot, include_archive: true });
    const again = search({ text: "vitest", vault: fixture.vaultRoot + "/", include_archive: true });
    const bm = again.used.find((u) => u.name === "bm25")!;
    expect(bm.lazy_loaded_now).toBe(false); // 재로드했다면 true가 된다
  });
});

/**
 * `rel` · `min_rel` — 질의를 가로지르는 점수축.
 *
 * raw `score`는 질의마다 스케일이 달라(실측 63 vs 1,494) 임계값으로 못 쓴다.
 * 여기서 고정하는 계약은 셋이다: **top-1은 1.0**, **자른 건수를 보고한다**,
 * **생략하면 아무것도 거르지 않는다**.
 */
describe("rel · min_rel", () => {
  beforeEach(() => setup());

  it("BM25 행에 rel이 실리고 top-1은 1.0이다", () => {
    const r = search({ text: "태그", include_archive: true });
    const bm = r.results.filter((x) => x.sources.includes("bm25"));
    expect(bm.length).toBeGreaterThan(0);
    expect(bm[0].rel).toBe(1);
  });

  it("구조 전용 행의 rel은 null이다 — BM25가 안 본 문서다", () => {
    const r = search({ doc_kind: "adr" });
    const structuralOnly = r.results.filter((x) => !x.sources.includes("bm25"));
    expect(structuralOnly.length).toBeGreaterThan(0);
    for (const row of structuralOnly) expect(row.rel).toBeNull();
  });

  it("min_rel을 생략하면 아무것도 거르지 않는다", () => {
    const base = search({ text: "태그", include_archive: true });
    const bm = base.used.find((u) => u.name === "bm25");
    // 필터를 안 걸었으면 관련 필드 자체가 없어야 한다(계약 유지).
    expect(bm).toBeDefined();
    expect((bm as Record<string, unknown>).min_rel).toBeUndefined();
    expect((bm as Record<string, unknown>).dropped_by_min_rel).toBeUndefined();
  });

  it("min_rel이 꼬리를 자르고 자른 건수를 보고한다", () => {
    const base = search({ text: "태그", include_archive: true });
    const baseBm = base.results.filter((x) => x.sources.includes("bm25")).length;
    expect(baseBm).toBeGreaterThan(1); // 자를 게 있어야 의미 있는 테스트다

    const cut = search({ text: "태그", include_archive: true, min_rel: 1 });
    const cutBm = cut.results.filter((x) => x.sources.includes("bm25")).length;
    expect(cutBm).toBeLessThan(baseBm);

    const used = cut.used.find((u) => u.name === "bm25") as Record<string, unknown>;
    expect(used.min_rel).toBe(1);
    expect(used.dropped_by_min_rel).toBe(baseBm - cutBm);
  });

  it("[0,1] 밖 값은 클램프한다 — 음수는 필터를 끈다", () => {
    const base = search({ text: "태그", include_archive: true });
    const neg = search({ text: "태그", include_archive: true, min_rel: -3 });
    expect(neg.results.length).toBe(base.results.length);
    // 0으로 떨어지면 필터를 안 건 것과 같아 관련 필드가 없다.
    const used = neg.used.find((u) => u.name === "bm25") as Record<string, unknown>;
    expect(used.min_rel).toBeUndefined();
  });

  it("NaN은 필터를 끈다 — 전부 걸러 '인덱스가 비었다'로 오해시키지 않는다", () => {
    const base = search({ text: "태그", include_archive: true });
    const nan = search({ text: "태그", include_archive: true, min_rel: Number.NaN });
    expect(nan.results.length).toBe(base.results.length);
  });
});

/**
 * v8 — fingerprint 재현으로 stale을 **정확히** 판정한다.
 *
 * 그 전에는 mtime 프록시라 `mcp/README.md`가 적어둔 대로 "삭제만 있고 수정이 없는
 * 변경을 놓친다"였다. 최신이라고 답하는데 실제로는 낡은 색인 — 조용한 오답이다.
 */
describe("stale 정확 판정 (v8)", () => {
  beforeEach(() => setup());

  it("아무것도 안 바뀌면 stale 필드가 없다", () => {
    expect(search({ doc_kind: "adr" }).stale).toBeUndefined();
  });

  it("mtime을 보존한 채 내용만 바꿔도 잡는다 — 프록시가 놓치던 경로", () => {
    const target = nodePath.join(fx.vaultRoot, "proj/adr/001-abandoned.md");

    // ⚠️ 기준 mtime을 **ms 정밀도 값으로 먼저 못박는다.**
    //
    // 파일시스템 mtime은 ns까지 있는데(ext4) `utimesSync`에 넘기는 JS `Date`는 ms
    // 정밀도다. 원본을 읽어 그대로 되돌리면 소수부가 잘려 **1ms 어긋난다** — Linux
    // CI에서만 터지고 Windows에선 우연히 맞아 통과했다. 같은 ms 값을 두 번 쓰면
    // 파일시스템이 무엇이든 정확히 같다.
    const pinned = new Date(Math.floor(statSync(target).mtimeMs));
    utimesSync(target, pinned, pinned);
    const before = statSync(target);

    // 외부 도구가 mtime을 유지하며 in-place로 쓴 상황을 그대로 만든다.
    writeFileSync(target, "---\ndoc_kind: adr\n---\n내용이 통째로 달라졌다.\n");
    utimesSync(target, pinned, pinned);

    const after = statSync(target);
    expect(after.mtimeMs).toBe(before.mtimeMs); // mtime은 그대로
    expect(after.size).not.toBe(before.size); // 크기만 달라졌다

    resetState();
    const stale = search({ doc_kind: "adr" }).stale;
    expect(stale).toBeDefined();
    expect(stale?.changed).toBe(true);
    // mtime 프록시로는 0이다 — 그래서 예전엔 "최신"이라고 답했다.
    expect(stale?.newer_count).toBe(0);
  });

  it("파일을 지워도 잡는다", () => {
    rmSync(nodePath.join(fx.vaultRoot, "proj/adr/001-abandoned.md"));
    resetState();
    const stale = search({ doc_kind: "adr" }).stale;
    expect(stale?.changed).toBe(true);
    expect(stale?.newer_count).toBe(0);
  });

  it("stale에 지금 계산한 fingerprint가 실린다", () => {
    rmSync(nodePath.join(fx.vaultRoot, "proj/adr/001-abandoned.md"));
    resetState();
    const stale = search({ doc_kind: "adr" }).stale;
    expect(stale?.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(stale?.fingerprint).not.toBe(fx.fingerprint);
  });
});
