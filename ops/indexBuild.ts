import MiniSearch from "minisearch";

import {
  FULLTEXT_OPTIONS,
  computeShardId,
  decideShardCount,
  type FullTextDoc,
} from "$lib/fullTextOptions";

/**
 * 헤드리스 인덱싱의 **Node 절반** — MiniSearch shard 빌드.
 *
 * ## 왜 절반만 여기 있나
 *
 * 두 원칙이 서로 다른 쪽을 요구한다.
 *
 * - **인덱스 생산자는 Rust 하나뿐**(README 설계 원칙). 위키링크·프론트매터 추출은
 *   `vault.rs`에만 있다. Node에서 다시 짜면 두 스캐너가 반드시 어긋난다.
 * - **풀텍스트 shard는 MiniSearch**로 만든다. `fullTextOptions.ts`가 단일 진실이고,
 *   Rust에 MiniSearch가 없다.
 *
 * 그래서 앱이 IPC 경계를 두고 하는 분업을 CLI는 **프로세스 경계**로 한다.
 *
 * ## ⚠️ 이 파일은 앱과 같은 함수를 부른다 — 복제하지 않는다
 *
 * `FULLTEXT_OPTIONS` · `computeShardId` · `decideShardCount` 전부 `$lib/fullTextOptions`
 * 에서 온다. 앱의 `rebuildIndexes`(`src/lib/stores/search.ts`)가 쓰는 바로 그것들이다.
 *
 * 하나라도 베끼면 CLI가 만든 인덱스와 앱이 만든 인덱스가 **조용히 다른 shard 배정이나
 * 다른 토큰 공간**을 갖게 된다. `CACHE_VERSION`이 같으니 앱은 그걸 정상으로 읽는다 —
 * 검색 결과가 틀리는데 아무 오류도 안 난다.
 */

/** Rust `--headless export-index`가 내는 것 중 shard 빌드에 쓰는 부분. */
export interface NoteContentIn {
  path: string;
  name: string;
  body: string;
}

export interface ShardOut {
  shard_id: number;
  minisearch_json: string;
}

export interface BuildResult {
  shardCount: number;
  shards: ShardOut[];
  /** shard별 문서 수 — 사람이 분포를 눈으로 볼 수 있게. 균등하지 않으면 해시가 이상한 것이다. */
  perShard: number[];
}

/**
 * 노트 본문 → shard별 MiniSearch JSON.
 *
 * 앱의 `rebuildIndexes`와 같은 순서다: `decideShardCount` → `computeShardId`로 분배 →
 * shard마다 새 인덱스에 `addAll` → `toJSON`.
 *
 * ⚠️ 앱은 배치를 나눠 넣는다(`POST_BATCH`). 그건 **UI 프리즈를 막으려는 것**이지
 * 인덱스 내용과는 무관하다 — 여기엔 양보할 UI가 없으므로 한 번에 넣는다. 결과는 같다.
 */
/**
 * @param titleByPath frontmatter title. `NoteContentIn`(Rust 번들의 본문 쪽)에는 없고
 *   같은 내보내기의 `link_infos`에 있다. **앱과 같은 문서를 만들어야** 하므로 여기서도
 *   싣는다 — 빠뜨리면 CLI가 만든 인덱스와 앱이 만든 인덱스의 토큰 공간이 갈린다.
 */
export function buildShards(
  contents: readonly NoteContentIn[],
  titleByPath: ReadonlyMap<string, string> = new Map(),
): BuildResult {
  const shardCount = decideShardCount(contents.length);
  const buckets: FullTextDoc[][] = Array.from({ length: shardCount }, () => []);
  for (const n of contents) {
    buckets[computeShardId(n.path, shardCount)].push({
      id: n.path,
      name: n.name,
      title: titleByPath.get(n.path) ?? "",
      body: n.body,
    });
  }

  const shards: ShardOut[] = [];
  for (let i = 0; i < shardCount; i++) {
    const mini = new MiniSearch<FullTextDoc>(FULLTEXT_OPTIONS);
    mini.addAll(buckets[i]);
    // ⚠️ 빈 shard도 **반드시 쓴다.** 건너뛰면 `shard_count`보다 파일이 적어지고, 읽는
    // 쪽(`buildFullTextFromPending`)은 결손 하나에 풀텍스트 캐시를 통째로 버린다.
    shards.push({ shard_id: i, minisearch_json: JSON.stringify(mini) });
  }

  return { shardCount, shards, perShard: buckets.map((b) => b.length) };
}
