/**
 * vault를 바꾸면 **풀텍스트 워커도 비워지는지** 고정한다.
 *
 * ## 왜 이 테스트가 있나
 *
 * `openVault()`는 `linkIndex`·탭·nav 이력을 비우면서 주석에 "stale 검색/백링크 노출
 * 방지"라고 의도까지 적어 뒀는데, **정작 풀텍스트 워커는 안 비웠다.**
 *
 * shard는 `addToShard`의 `reset`으로만 새로 만들어지고 그건 **새 vault가 쓰는 shard에만**
 * 걸린다. `decideShardCount`는 노트 수로 정해지므로 19,000노트(8 shard) → 74노트(1 shard)
 * 전환이면 shard 1–7이 이전 vault 문서를 그대로 들고 남는다. 그리고 `unionRank`는
 * **ready된 모든 shard**에 질의한다 → 이전 vault 문서가 검색 결과로 새어 나온다.
 *
 * README가 "창마다 다른 vault"를 기능으로 파는 만큼 가볍지 않다. 2026-08-20 데모 vault로
 * 갈아탄 직후 검색에 이전 vault 문서가 그대로 떠서 드러났다.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 호출 순서를 본다. `workerReset`은 캐시 로드 실패 복구 경로(`vault.ts`의 shard 결손
 * 처리)에서도 불리므로 **"불렸는가"만 보면 변별력이 없다** — 수정 없이도 통과한다.
 * 고정해야 하는 건 "vault 전환 시점에, 새 vault 색인이 시작되기 **전에** 비운다"이다.
 */
const order: string[] = [];
const workerReset = vi.fn(async () => {
  order.push("workerReset");
});

vi.mock("$lib/tauri/notes", () => ({
  listNotes: vi.fn(async () => {
    order.push("listNotes");
    return [];
  }),
  readNote: vi.fn(async () => "본문"),
  // ⚠️ vitest는 `import.meta.env.DEV`가 true라 perf 로깅 경로가 돈다 → `stats` 필요.
  readVaultBundle: vi.fn(async () => ({ links: [], contents: [], stats: { file_count: 0 } })),
  vaultFingerprint: vi.fn(async () => ({ fingerprint: "fp", file_count: 0 })),
  vaultFileStats: vi.fn(async () => ({ fingerprint: "fp", files: [], walk_ms: 0 })),
  readSearchCacheMeta: vi.fn(async () => null),
  readSearchCacheShard: vi.fn(async () => null),
  readSearchCacheStats: vi.fn(async () => null),
  writeSearchCacheMeta: vi.fn(async () => {}),
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
  scanLinkSingle: vi.fn(),
}));

vi.mock("$lib/searchIndex", () => ({
  buildQuickEntries: () => [],
  workerLoadShard: vi.fn(async () => {}),
  workerToJSONShard: vi.fn(async () => "{}"),
  workerUpdateDoc: vi.fn(async () => {}),
  workerRemoveDoc: vi.fn(async () => {}),
  workerReset: (...a: unknown[]) => workerReset(...(a as [])),
  computeShardId: () => 0,
  decideShardCount: () => 1,
}));

vi.mock("$lib/tauri/watcher", () => ({
  watchVault: vi.fn(async () => {}),
  unwatchVault: vi.fn(async () => {}),
  onVaultChange: vi.fn(() => () => {}),
}));

vi.mock("./unread", () => ({
  markOpened: vi.fn(),
  syncFromDisk: vi.fn(async () => {}),
}));

const { openVault, vaultPath } = await import("./vault");

beforeEach(() => {
  workerReset.mockClear();
  order.length = 0;
});

describe("openVault", () => {
  it("vault를 바꾸면 새 vault를 읽기 전에 풀텍스트 워커를 비운다", async () => {
    await openVault("/vault-a");
    order.length = 0;

    await openVault("/vault-b");

    // `clearIndexes()` → `workerReset()`이 `reloadNotes()`(→ `listNotes`)보다 먼저.
    // 뒤에 오면 이전 vault의 shard를 안고 새 vault 문서를 얹는 셈이라 검색이 섞인다.
    expect(order).toContain("workerReset");
    expect(order.indexOf("workerReset")).toBeLessThan(order.indexOf("listNotes"));
  });
});
