/**
 * **기동 델타 재조정**이 실제로 vault 전량 재읽기를 건너뛰는지 고정한다.
 *
 * ## 왜 이 테스트가 있나
 *
 * `vault_fingerprint`는 vault 전량의 `(path, mtime, size)`를 한 덩어리로 해싱한다.
 * 그래서 `meta.fingerprint !== fp.fingerprint` 한 줄이 hit/miss를 갈랐고, **노트 1개가
 * 바뀌어도 전량 재빌드**였다. 실측(19,364 노트): 하루 사이 바뀐 md는 38개(0.2%)인데
 * 그때마다 52.6 MB를 다시 읽고 5.3 s를 다시 색인했다. 30일 중 19일에 변경이 있었으니
 * 평상시 기동의 대다수가 그 경로였다.
 *
 * 고정해야 하는 명제는 **"바뀐 파일만 읽는다"** 하나다. 그래서 이 테스트의 핵심 단언은
 * "`readVaultBundle`이 안 불렸다"이다 — 인덱스 내용만 보면 풀 빌드로도 통과한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

type Stat = { path: string; mtime_ms: number; size: number };

function linkInfo(path: string) {
  return {
    source_path: path,
    source_name: path.split("/").pop()!.replace(/\.md$/, ""),
    title: null,
    aliases: [],
    targets: [],
    tags: [],
    doc_kind: null,
    topic: null,
    related: [],
    props: {},
  };
}

/** 테스트마다 갈아끼우는 시나리오 상태. */
const scene = {
  metaFingerprint: "fp-old",
  currentFingerprint: "fp-new",
  shardCount: 1,
  /** `decideShardCount` 대역 — shard 수 판정 자체를 보는 테스트만 기본값을 쓴다. */
  shardsFor: ((n: number) => (n < 1000 ? 1 : 4)) as (n: number) => number,
  metaPaths: ["/v/a.md", "/v/b.md"],
  /** 디스크 stats 파일이 들고 있는 fingerprint. meta와 어긋나면 Rust가 거부한다. */
  statsFingerprint: "fp-old",
  prevStats: null as Stat[] | null,
  curStats: [] as Stat[],
};

const readVaultBundle = vi.fn(async () => ({
  links: scene.curStats.map((s) => linkInfo(s.path)),
  contents: [],
  stats: { file_count: scene.curStats.length, walk_ms: 0, read_ms: 0 },
}));
const scanLinkSingle = vi.fn(async (_root: string, path: string) => linkInfo(path));
const workerUpdateDoc = vi.fn(async (..._a: unknown[]) => {});
const workerRemoveDoc = vi.fn(async (..._a: unknown[]) => {});
/**
 * shard가 올라오는 **매 시점의** `fullTextIndexReady`를 적어 둔다.
 *
 * ⚠️ `reloadNotes()` 직후에 ready를 보는 것만으로는 아무것도 검증되지 않는다 — lazy
 * 로드는 `setTimeout(…, 50)` 뒤에 시작하므로 그 시점엔 어떤 구현이든 false다. 실제로
 * 카나리아(`i === 0`에서 ready를 세우도록 되돌리기)가 그 단언을 그냥 통과했다.
 * 관찰해야 하는 창은 **shard0 로드 이후 ~ 패치 이전**이고, 그건 여기서만 보인다.
 */
const readyAtShardLoad: boolean[] = [];
let readyAtFirstPatch: boolean | null = null;
const workerLoadShard = vi.fn(async (..._a: unknown[]) => {});
const writeMeta = vi.fn(async (..._a: unknown[]) => {});

vi.mock("$lib/tauri/notes", () => ({
  listNotes: vi.fn(async () => []),
  readNote: vi.fn(async () => "본문"),
  readVaultBundle: (...a: unknown[]) => readVaultBundle(...(a as [])),
  vaultFingerprint: vi.fn(async () => ({
    fingerprint: scene.currentFingerprint,
    file_count: scene.curStats.length,
    walk_ms: 0,
  })),
  vaultFileStats: vi.fn(async () => ({
    fingerprint: scene.currentFingerprint,
    files: scene.curStats,
    walk_ms: 0,
  })),
  readSearchCacheMeta: vi.fn(async () => ({
    version: 7,
    fingerprint: scene.metaFingerprint,
    link_infos: scene.metaPaths.map(linkInfo),
    shard_count: scene.shardCount,
  })),
  readSearchCacheStats: vi.fn(async (_v: string, expect_fp: string) =>
    // Rust 쪽 `stats_reject_reason`을 그대로 흉내낸다 — 파일이 들고 있는 fingerprint가
    // 호출자가 기대한 것(= meta의 것)과 다르면 `null`이다.
    scene.prevStats && expect_fp === scene.statsFingerprint ? scene.prevStats : null,
  ),
  readSearchCacheShard: vi.fn(async () => "{}"),
  writeSearchCacheMeta: (...a: unknown[]) => writeMeta(...a),
  writeSearchCacheShard: vi.fn(async () => {}),
  writeSearchCacheStats: vi.fn(async () => {}),
  createNote: vi.fn(),
  createFolder: vi.fn(),
  deleteNote: vi.fn(),
  renameNote: vi.fn(),
  moveNote: vi.fn(),
  writeNote: vi.fn(),
  backupNotes: vi.fn(),
  pruneLinkRewriteBackups: vi.fn(),
  scanLinkSingle: (...a: unknown[]) => scanLinkSingle(...(a as [string, string])),
}));

vi.mock("$lib/searchIndex", () => ({
  buildQuickEntries: () => [],
  workerLoadShard: async (...a: unknown[]) => {
    readyAtShardLoad.push(getReady());
    return workerLoadShard(...a);
  },
  workerToJSONShard: vi.fn(async () => "{}"),
  workerUpdateDoc: async (...a: unknown[]) => {
    if (readyAtFirstPatch === null) readyAtFirstPatch = getReady();
    return workerUpdateDoc(...a);
  },
  workerRemoveDoc: (...a: unknown[]) => workerRemoveDoc(...a),
  workerReset: vi.fn(async () => {}),
  workerAddToShard: vi.fn(async () => {}),
  computeShardId: () => 0,
  decideShardCount: (n: number) => scene.shardsFor(n),
}));

const { reloadNotes, vaultPath, linkIndex } = await import("./vault");
const { fullTextIndexReady } = await import("./search");

/** mock 팩토리는 hoist 되므로 store를 직접 못 닫는다 — 호출 시점에 해소한다. */
function getReady(): boolean {
  return get(fullTextIndexReady);
}

/** lazy 풀텍스트 로드는 `requestIdleCallback` 없으면 `setTimeout(…, 50)`. */
const flushLazy = () => new Promise((r) => setTimeout(r, 80));

function stat(path: string, mtime: number): Stat {
  return { path, mtime_ms: mtime, size: 10 };
}

/**
 * ⚠️ **매 테스트 끝에 lazy 타이머를 비운다.** 안 하면 앞 테스트의 타이머가 뒤 테스트
 * 안에서 터진다.
 *
 * `scheduleLazyFullTextLoad`는 **모듈 수준** `lazyLoadScheduled` 플래그와 **취소 장치가
 * 없는** `setTimeout(…, 50)`이다. 앱에서는 문제가 없다 — 수명이 하나고, 그 플래그가
 * 중복 예약을 막는다. 하지만 테스트는 같은 모듈 인스턴스를 공유하므로, `flushLazy()`를
 * 부르지 않고 끝난 테스트가 **살아 있는 타이머를 남긴다.**
 *
 * 그게 다음 테스트의 관측 창 안에서 실행되면 그 테스트의 mock 호출이 하나 더 늘어
 * `expected 1 times, but got 2 times`가 된다. 창에 들어오느냐가 부하에 달려 있어
 * **Linux CI에서만 간헐적으로** 터졌다(Windows·macOS 로컬은 빨라서 대개 그 전에 소진됐다).
 *
 * `vi.useFakeTimers()`로 바꾸지 않은 이유 — 이 스위트는 `await reloadNotes()`가 내부에서
 * 도는 여러 겹의 실제 마이크로태스크에 기대고 있어, 타이머만 가짜로 만들면 그 순서가
 * 통째로 달라진다. 여기서 필요한 건 **경계에서 비우는 것**뿐이다.
 */
afterEach(async () => {
  await flushLazy();
});

beforeEach(() => {
  vi.clearAllMocks();
  vaultPath.set("/v");
  linkIndex.set(null);
  fullTextIndexReady.set(false);
  readyAtShardLoad.length = 0;
  readyAtFirstPatch = null;
  scene.metaFingerprint = "fp-old";
  scene.statsFingerprint = "fp-old";
  scene.currentFingerprint = "fp-new";
  scene.shardCount = 1;
  scene.shardsFor = (n: number) => (n < 1000 ? 1 : 4);
  scene.metaPaths = ["/v/a.md", "/v/b.md"];
  scene.prevStats = [stat("/v/a.md", 1), stat("/v/b.md", 1)];
  scene.curStats = [stat("/v/a.md", 2), stat("/v/b.md", 1)]; // a만 수정
});

describe("기동 델타 재조정", () => {
  it("⭐ 1건만 바뀌면 vault 전량을 다시 읽지 않는다", async () => {
    await reloadNotes();
    expect(readVaultBundle).not.toHaveBeenCalled();
    // 바뀐 파일만 다시 스캔한다.
    expect(scanLinkSingle).toHaveBeenCalledTimes(1);
    expect(scanLinkSingle.mock.calls[0]?.[1]).toBe("/v/a.md");
    // 안 바뀐 노트도 인덱스에 그대로 살아 있어야 한다(meta에서 이월).
    expect(get(linkIndex)?.byPath.has("/v/b.md")).toBe(true);
  });

  it("신규·삭제도 반영한다", async () => {
    scene.curStats = [stat("/v/a.md", 1), stat("/v/new.md", 5)]; // b 삭제, new 추가
    await reloadNotes();

    expect(readVaultBundle).not.toHaveBeenCalled();
    const idx = get(linkIndex);
    expect(idx?.byPath.has("/v/new.md")).toBe(true);
    expect(idx?.byPath.has("/v/b.md")).toBe(false);
  });

  it("stats 스냅샷이 없으면 예전대로 풀 빌드 — 이 기능 이전 캐시와의 호환", async () => {
    scene.prevStats = null;
    await reloadNotes();
    expect(readVaultBundle).toHaveBeenCalledTimes(1);
  });

  it("stats가 meta와 어긋나면 풀 빌드 — 어긋난 근거로는 델타를 내지 않는다", async () => {
    // 저장 중간에 죽어 meta와 stats가 다른 스냅샷인 상태. 그대로 쓰면 바뀐 파일을
    // 안 바뀐 것으로 판정한다 → Rust가 거부하고 호출부는 풀 빌드로 간다.
    scene.statsFingerprint = "fp-stale";
    await reloadNotes();
    expect(readVaultBundle).toHaveBeenCalledTimes(1);
    expect(scanLinkSingle).not.toHaveBeenCalled();
  });

  it("변경이 상한을 넘으면 풀 빌드", async () => {
    scene.metaPaths = Array.from({ length: 300 }, (_, i) => `/v/${i}.md`);
    scene.prevStats = scene.metaPaths.map((p) => stat(p, 1));
    scene.curStats = scene.metaPaths.map((p) => stat(p, 2)); // 300건 전부 수정
    await reloadNotes();
    expect(readVaultBundle).toHaveBeenCalledTimes(1);
  });

  it("shard 수가 바뀌는 규모면 풀 빌드 — computeShardId가 전부 달라진다", async () => {
    scene.metaPaths = Array.from({ length: 999 }, (_, i) => `/v/${i}.md`);
    scene.prevStats = scene.metaPaths.map((p) => stat(p, 1));
    // 노트 1개 추가로 1000 돌파 → decideShardCount 1 → 4
    scene.curStats = [...scene.prevStats, stat("/v/new.md", 1)];
    await reloadNotes();
    expect(readVaultBundle).toHaveBeenCalledTimes(1);
  });

  it("풀텍스트 shard는 옛 fingerprint로 읽고, 바뀐 노트만 덮어쓴다", async () => {
    await reloadNotes();
    await flushLazy();

    expect(workerLoadShard).toHaveBeenCalledTimes(1);
    expect(workerUpdateDoc).toHaveBeenCalledTimes(1);
    expect((workerUpdateDoc.mock.calls[0]?.[1] as { id: string })?.id).toBe("/v/a.md");
    expect(get(fullTextIndexReady)).toBe(true);
  });

  it("\u2b50 \ud328\uce58 \uc804\uc5d0\ub294 ready\ub97c \uc138\uc6b0\uc9c0 \uc54a\ub294\ub2e4", async () => {
    // shard 2개짜리 스냅샷: shard0이 올라온 **뒤** shard1을 로드하는 시점을 관찰한다.
    // 평소(패치 없는 cache hit)엔 shard0에서 ready를 세워 progressive 검색을 열어주는데,
    // 델타 경로에서 그러면 바뀐 노트의 **옛 본문**이 검색된다. "검색했는데 안 나온다"보다
    // "검색했는데 틀린 게 나온다"가 나쁘다.
    scene.shardCount = 2;
    scene.shardsFor = () => 2; // 이 스냅샷은 2 shard로 저장돼 있다
    await reloadNotes();
    await flushLazy();

    expect(readyAtShardLoad).toEqual([false, false]);
    expect(readyAtFirstPatch).toBe(false);
    expect(get(fullTextIndexReady)).toBe(true); // 패치가 끝나고 나서야
  });

  it("삭제된 노트는 shard에서도 빠진다", async () => {
    scene.curStats = [stat("/v/a.md", 1)]; // b 삭제만
    await reloadNotes();
    await flushLazy();
    expect(workerRemoveDoc).toHaveBeenCalledTimes(1);
    expect(workerRemoveDoc.mock.calls[0]?.[1]).toBe("/v/b.md");
  });

  it("패치까지 끝나야 새 fingerprint로 커밋한다", async () => {
    await reloadNotes();
    // 구조만 적용된 시점에 커밋하면 shard가 아직 옛 스냅샷인데 meta는 최신이라 주장한다.
    expect(writeMeta).not.toHaveBeenCalled();

    await flushLazy();
    await new Promise((r) => setTimeout(r, 0)); // 저장은 setTimeout(0) 뒤

    expect(writeMeta).toHaveBeenCalledTimes(1);
    expect(writeMeta.mock.calls[0]?.[1]).toBe("fp-new");
  });
});
