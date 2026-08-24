/**
 * 증분 재인덱싱이 **디스크 캐시를 반드시 재저장하는지** 고정한다.
 *
 * ## 왜 이 테스트가 있나
 *
 * `saveSearchCache`는 내부에서 게이트를 나눠 놓았다 — 구조 데이터(meta)는 항상 쓰고,
 * 풀텍스트 shard는 `fullTextIndexReady`일 때만 쓴다. 그런데 **호출부에 `if (ftReady)`가
 * 그대로 남아 있어서** 그 분리가 무의미했다. 바깥 게이트가 안쪽 분리를 덮어쓴 것이다.
 *
 * 증상이 고약했다. cache **HIT**로 뜬 세션은 풀텍스트가 idle 지연 로드라 재인덱싱 시점에
 * `ftReady`가 아직 false다 → **편집해도 디스크 캐시가 영영 갱신되지 않는다.** MISS로 뜬
 * 세션은 `rebuildIndexes`가 ready를 세워두니 정상 동작해서, 재현이 기동 유형에 따라
 * 갈렸다. 2026-08-13 실측으로 두 경우를 나란히 재현해 원인을 특정했다.
 *
 * 이게 지식 질의 MCP의 전제를 깼다 — "앱을 켜두면 인덱스가 최신"이 거짓이었고, 편집
 * 직후부터 앱 재시작까지 계속 `stale`이었다.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

// `unknown[]`로 받아야 호출 인자를 인덱스로 꺼낼 수 있다 — `vi.fn(async () => {})`는
// 인자 타입이 빈 튜플로 추론돼 `mock.calls[0][3]` 접근이 타입 오류가 된다.
const writeMeta = vi.fn(async (..._args: unknown[]) => {});
const writeShard = vi.fn(async (..._args: unknown[]) => {});
const writeStats = vi.fn(async (..._args: unknown[]) => {});

vi.mock("$lib/tauri/notes", () => ({
  listNotes: vi.fn(async () => []),
  readNote: vi.fn(async () => "본문"),
  readVaultBundle: vi.fn(async () => ({ links: [], contents: [] })),
  vaultFingerprint: vi.fn(async () => ({ fingerprint: "fp-new", file_count: 1 })),
  vaultFileStats: vi.fn(async () => ({
    fingerprint: "fp-new",
    files: [{ path: "/vault/a.md", mtime_ms: 2, size: 2 }],
    walk_ms: 0,
  })),
  readSearchCacheMeta: vi.fn(async () => null),
  readSearchCacheShard: vi.fn(async () => null),
  readSearchCacheStats: vi.fn(async () => null),
  writeSearchCacheMeta: (...a: unknown[]) => writeMeta(...a),
  writeSearchCacheShard: (...a: unknown[]) => writeShard(...a),
  writeSearchCacheStats: (...a: unknown[]) => writeStats(...a),
  createNote: vi.fn(),
  createFolder: vi.fn(),
  deleteNote: vi.fn(),
  renameNote: vi.fn(),
  moveNote: vi.fn(),
  writeNote: vi.fn(),
  backupNotes: vi.fn(),
  pruneLinkRewriteBackups: vi.fn(),
  scanLinkSingle: vi.fn(async (_root: string, path: string) => ({
    source_path: path,
    source_name: "n",
    title: null,
    aliases: [],
    targets: [],
    tags: [],
    doc_kind: null,
    topic: null,
    related: [],
    props: {},
  })),
}));

vi.mock("$lib/searchIndex", () => ({
  buildQuickEntries: () => [],
  workerLoadShard: vi.fn(async () => {}),
  workerToJSONShard: vi.fn(async () => "{}"),
  workerUpdateDoc: vi.fn(async () => {}),
  workerRemoveDoc: vi.fn(async () => {}),
  workerReset: vi.fn(async () => {}),
  computeShardId: () => 0,
  decideShardCount: () => 1, // 활성 shard 수(1)와 같아야 증분 경로를 탄다
}));

const { reindexIncremental, vaultPath, linkIndex } = await import("./vault");
const { fullTextIndexReady } = await import("./search");

function seedIndex(): void {
  vaultPath.set("/vault");
  linkIndex.set({
    byPath: new Map([["/vault/a.md", { source_path: "/vault/a.md" }]]),
    resolver: new Map(),
    backlinks: new Map(),
    relations: { outgoing: new Map(), incoming: new Map() },
  } as never);
}

/** `setTimeout(…, 0)`로 미뤄진 저장이 끝나기를 기다린다. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  writeMeta.mockClear();
  writeShard.mockClear();
  writeStats.mockClear();
  seedIndex();
});

describe("증분 재인덱싱 → 캐시 재저장", () => {
  // ⚠️ 핵심. 예전엔 호출부 `if (ftReady)`가 이 저장 전체를 막아, cache HIT 세션에서는
  // 편집해도 디스크 캐시가 갱신되지 않았다.
  it("풀텍스트가 준비되지 않아도 meta는 저장한다", async () => {
    fullTextIndexReady.set(false);
    await reindexIncremental(["/vault/a.md"], []);
    await flush();
    expect(writeMeta).toHaveBeenCalledTimes(1);
  });

  it("풀텍스트가 준비되지 않았으면 shard는 쓰지 않는다", async () => {
    fullTextIndexReady.set(false);
    await reindexIncremental(["/vault/a.md"], []);
    await flush();
    expect(writeShard).not.toHaveBeenCalled();
  });

  it("shard_count는 실제로 쓴 수로 커밋한다 — 풀텍스트 없으면 0", async () => {
    fullTextIndexReady.set(false);
    await reindexIncremental(["/vault/a.md"], []);
    await flush();
    // writeSearchCacheMeta(root, fingerprint, links, shardCount)
    expect(writeMeta.mock.calls[0]?.[3]).toBe(0); // shardCount 인자
  });

  it("풀텍스트가 준비됐으면 shard도 함께 저장한다", async () => {
    fullTextIndexReady.set(true);
    await reindexIncremental(["/vault/a.md"], []);
    await flush();
    expect(writeShard).toHaveBeenCalled();
    expect(writeMeta.mock.calls[0]?.[3]).toBe(1);
  });

  it("저장은 shard → stats → meta 순 — meta가 커밋 지점이다", async () => {
    // stats가 meta **뒤로** 가면 "새 meta + 옛 stats"가 남아, 다음 기동의 델타가
    // 바뀐 파일을 안 바뀐 것으로 판정한다(= 낡은 인덱스를 최신으로 고정).
    fullTextIndexReady.set(true);
    const order: string[] = [];
    writeShard.mockImplementation(async () => void order.push("shard"));
    writeStats.mockImplementation(async () => void order.push("stats"));
    writeMeta.mockImplementation(async () => void order.push("meta"));

    await reindexIncremental(["/vault/a.md"], []);
    await flush();
    expect(order).toEqual(["shard", "stats", "meta"]);
  });

  it("stats 저장이 실패해도 meta는 커밋한다 — 델타는 최적화지 정확성이 아니다", async () => {
    fullTextIndexReady.set(false);
    writeStats.mockImplementationOnce(async () => {
      throw new Error("disk full");
    });
    await reindexIncremental(["/vault/a.md"], []);
    await flush();
    expect(writeMeta).toHaveBeenCalledTimes(1);
  });

  it("파생 인덱스도 갱신된다(회귀 감시용 최소 확인)", async () => {
    fullTextIndexReady.set(false);
    await reindexIncremental(["/vault/a.md"], []);
    expect(get(linkIndex)?.byPath.has("/vault/a.md")).toBe(true);
  });
});
