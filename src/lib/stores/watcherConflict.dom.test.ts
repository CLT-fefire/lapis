import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

/**
 * 외부 변경 충돌 해결 — **테스트가 0이었다.**
 *
 * 상황: 편집 중인 노트를 **밖에서도** 고쳤다. 둘 중 하나를 버려야 하는데, 여기서 조용히
 * 틀리면 **사용자가 쓴 것이 사라진다.** 되돌릴 수 없는 손실이라 다른 조용한 실패보다 나쁘다.
 *
 * `watcher.ts` 는 Tauri IPC 를 물고 있어 전부는 못 띄운다 — 충돌 **해결 두 갈래**만 본다.
 */

const readNote = vi.fn<(p: string) => Promise<string>>();
const markSaved = vi.fn<(content: string) => void>();

vi.mock("$lib/tauri/watcher", () => ({
  watchVault: vi.fn(),
  unwatchVault: vi.fn(),
  onVaultChange: vi.fn(async () => () => {}),
}));
vi.mock("$lib/tauri/notes", () => ({ readNote: (p: string) => readNote(p) }));
vi.mock("$lib/backlinks", () => ({ invalidateCacheBySource: vi.fn() }));
vi.mock("./unread", () => ({ markChangedFromWatcher: vi.fn() }));
vi.mock("./mtimes", () => ({ touchMtime: vi.fn(), dropMtime: vi.fn() }));
vi.mock("./git", () => ({ scheduleAutoCommit: vi.fn() }));
vi.mock("./vault", () => ({
  vaultPath: { subscribe: (f: (v: string | null) => void) => (f(null), () => {}) },
  currentNotePath: { subscribe: (f: (v: string | null) => void) => (f(null), () => {}) },
  closeTab: vi.fn(),
  reindexIncremental: vi.fn(),
}));
vi.mock("./editor", () => ({ markSaved: (c: string) => markSaved(c) }));

const { externalConflict, resolveConflictAcceptExternal, resolveConflictKeepLocal } = await import(
  "./watcher"
);

beforeEach(() => {
  readNote.mockReset();
  markSaved.mockReset();
  externalConflict.set(null);
});

describe("외부 변경 사용", () => {
  it("디스크 내용을 읽어 편집기에 세우고 충돌을 닫는다", async () => {
    externalConflict.set({ path: "/v/a.md", externalContent: "바깥 내용" } as never);
    readNote.mockResolvedValue("디스크의 최신 내용");

    await resolveConflictAcceptExternal();

    expect(readNote, "저장된 스냅샷이 아니라 **지금** 디스크를 읽어야 한다").toHaveBeenCalledWith(
      "/v/a.md",
    );
    expect(markSaved).toHaveBeenCalledWith("디스크의 최신 내용");
    expect(get(externalConflict)).toBeNull();
  });

  /**
   * ⚠️ **읽기에 실패하면 충돌을 닫으면 안 된다.** 닫으면 사용자는 해결된 줄 알고 계속
   * 편집하다가 다음 저장에서 남의 변경을 덮어쓴다.
   */
  it("읽기에 실패하면 충돌이 남는다", async () => {
    const conflict = { path: "/v/a.md", externalContent: "바깥" } as never;
    externalConflict.set(conflict);
    readNote.mockRejectedValue(new Error("boom"));

    await resolveConflictAcceptExternal();

    expect(markSaved, "실패했는데 편집기를 갈아치우면 안 된다").not.toHaveBeenCalled();
    expect(get(externalConflict), "충돌이 남아 있어야 다시 시도할 수 있다").not.toBeNull();
  });

  it("충돌이 없으면 아무 일도 안 한다", async () => {
    await resolveConflictAcceptExternal();
    expect(readNote).not.toHaveBeenCalled();
    expect(markSaved).not.toHaveBeenCalled();
  });
});

describe("내 변경 유지", () => {
  /** ⚠️ 편집기 내용을 **건드리면 안 된다** — 사용자가 지키겠다고 고른 것이다. */
  it("충돌만 닫고 편집기는 그대로", () => {
    externalConflict.set({ path: "/v/a.md", externalContent: "바깥" } as never);
    resolveConflictKeepLocal();
    expect(get(externalConflict)).toBeNull();
    expect(markSaved).not.toHaveBeenCalled();
  });
});
