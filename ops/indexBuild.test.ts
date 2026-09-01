import { describe, it, expect } from "vitest";
import MiniSearch from "minisearch";

import { buildShards, type NoteContentIn } from "./indexBuild.ts";
import {
  FULLTEXT_OPTIONS,
  computeShardId,
  decideShardCount,
  type FullTextDoc,
} from "$lib/fullTextOptions";

function notes(n: number, prefix = "/v/note"): NoteContentIn[] {
  return Array.from({ length: n }, (_, i) => ({
    path: `${prefix}${i}.md`,
    name: `note${i}`,
    body: `본문 ${i} lapis 인덱싱`,
  }));
}

describe("헤드리스 shard 빌드", () => {
  it("shard 수를 앱과 같은 규칙으로 정한다", () => {
    for (const n of [0, 1, 999, 1000, 4999, 5000]) {
      expect(buildShards(notes(n)).shardCount).toBe(decideShardCount(n));
    }
  });

  /**
   * ⚠️ 배정이 앱과 다르면 문서가 다른 shard로 가고, 그러면 **검색에서 사라진다.**
   * `CACHE_VERSION`은 같으니 앱은 그 캐시를 정상으로 받아들인다 — 오류 없이 틀린다.
   */
  it("문서를 앱과 같은 shard에 넣는다", () => {
    const docs = notes(1500);
    const { shardCount, shards } = buildShards(docs);
    expect(shardCount).toBeGreaterThan(1);

    const idsOf = (json: string) =>
      new Set(
        (MiniSearch.loadJSON<FullTextDoc>(json, FULLTEXT_OPTIONS) as MiniSearch<FullTextDoc>)
          .search("lapis", { ...FULLTEXT_OPTIONS.searchOptions, combineWith: "OR" })
          .map((h) => h.id as string),
      );

    for (const s of shards) {
      for (const id of idsOf(s.minisearch_json)) {
        expect(computeShardId(id, shardCount), `${id} 가 엉뚱한 shard에 있다`).toBe(s.shard_id);
      }
    }
  });

  /**
   * ⚠️ 빈 shard를 건너뛰면 파일 수가 `shard_count`보다 적어진다. 읽는 쪽
   * (`buildFullTextFromPending`)은 결손이 하나라도 있으면 **풀텍스트 캐시를 통째로
   * 버린다** — 부분 인덱스로 조용히 검색하는 것보다 낫다는 판단이라 이건 의도된 동작이다.
   * 그러니 생산자가 빠뜨리면 안 된다.
   */
  it("빈 shard도 파일을 낸다", () => {
    // 한 shard로 몰리는 경로를 일부러 만든다.
    const shardCount = decideShardCount(1200);
    const target = 0;
    const picked: NoteContentIn[] = [];
    for (let i = 0; picked.length < 1200; i++) {
      const p = `/v/n${i}.md`;
      if (computeShardId(p, shardCount) === target) picked.push({ path: p, name: `n${i}`, body: "x" });
    }
    const built = buildShards(picked);
    expect(built.shards).toHaveLength(built.shardCount);
    expect(built.shards.map((s) => s.shard_id)).toEqual(
      Array.from({ length: built.shardCount }, (_, i) => i),
    );
    expect(built.perShard.filter((n) => n === 0).length).toBeGreaterThan(0);
  });

  it("노트가 없어도 shard 하나를 낸다", () => {
    const built = buildShards([]);
    expect(built.shardCount).toBe(1);
    expect(built.shards).toHaveLength(1);
    expect(built.perShard).toEqual([0]);
  });

  it("shard_id가 0부터 연속이다", () => {
    const built = buildShards(notes(6000));
    expect(built.shards.map((s) => s.shard_id)).toEqual(
      Array.from({ length: built.shardCount }, (_, i) => i),
    );
  });

  it("문서를 하나도 잃지 않는다", () => {
    const built = buildShards(notes(1500));
    expect(built.perShard.reduce((a, b) => a + b, 0)).toBe(1500);
  });

  /** 앱의 worker가 하는 것과 같은 복원 — 여기서 한글이 깨지면 검색이 조용히 빈다. */
  it("복원해서 한글로 검색된다", () => {
    const built = buildShards([
      { path: "/v/a.md", name: "한글 노트", body: "헤드리스 인덱싱 설계 기록" },
      { path: "/v/b.md", name: "other", body: "unrelated english text" },
    ]);
    const mini = MiniSearch.loadJSON<FullTextDoc>(
      built.shards[0].minisearch_json,
      FULLTEXT_OPTIONS,
    );
    const hits = mini.search("인덱싱", FULLTEXT_OPTIONS.searchOptions);
    expect(hits.map((h) => h.id)).toContain("/v/a.md");
  });
});
