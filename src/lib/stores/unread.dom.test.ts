import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

/**
 * "안 본 사이 바뀐 노트" — **테스트가 0이었다.**
 *
 * ⚠️ 여기가 틀리면 **신호가 죽는다.** 너무 많이 켜지면(한 번도 안 연 노트까지) 12,000개가
 * 전부 볼드가 되어 아무 뜻이 없고, 너무 적게 켜지면 바뀐 걸 모른 채 옛 내용을 읽는다.
 * 둘 다 에러가 없다.
 */

const notesMtimes = vi.fn<(vault: string, paths: string[]) => Promise<[string, number][]>>();
vi.mock("$lib/tauri/notes", () => ({ notesMtimes: (v: string, p: string[]) => notesMtimes(v, p) }));

const {
  changedNotes,
  markOpened,
  markChangedFromWatcher,
  syncFromDisk,
  resetUnreadState,
  peekLastOpened,
} = await import("./unread");

beforeEach(() => {
  localStorage.clear();
  resetUnreadState();
  notesMtimes.mockReset();
});

describe("열람 기록", () => {
  it("연 시각을 기록하고 영속화한다", () => {
    markOpened("/v/a.md", 1000);
    expect(peekLastOpened()["/v/a.md"]).toBe(1000);
    expect(localStorage.getItem("lapis.last-opened")).toContain("/v/a.md");
  });

  it("열면 '변경됨'이 해제된다", () => {
    markOpened("/v/a.md", 1000);
    markChangedFromWatcher("/v/a.md", 2000);
    expect(get(changedNotes).has("/v/a.md")).toBe(true);
    markOpened("/v/a.md", 3000);
    expect(get(changedNotes).has("/v/a.md")).toBe(false);
  });
});

describe("watcher 판정", () => {
  /**
   * ⚠️ **한 번도 안 연 노트는 대상이 아니다.** 이건 "새 파일 알림"이 아니라 "내가 읽은
   * 뒤 바뀐 것"이다 — 안 그러면 첫 기동에 vault 전체가 볼드가 된다.
   */
  it("연 적 없는 노트는 안 켠다", () => {
    markChangedFromWatcher("/v/never.md", 9999);
    expect(get(changedNotes).size).toBe(0);
  });

  it("연 시각보다 나중에 바뀌어야 켠다", () => {
    markOpened("/v/a.md", 1000);
    markChangedFromWatcher("/v/a.md", 999);
    expect(get(changedNotes).size).toBe(0);
    markChangedFromWatcher("/v/a.md", 1001);
    expect(get(changedNotes).has("/v/a.md")).toBe(true);
  });

  /** ⚠️ 같은 시각은 "안 바뀐 것"이다 — `<=` 경계. */
  it("같은 시각이면 안 켠다", () => {
    markOpened("/v/a.md", 1000);
    markChangedFromWatcher("/v/a.md", 1000);
    expect(get(changedNotes).size).toBe(0);
  });
});

describe("시동 시 동기화", () => {
  it("앱이 꺼진 사이의 변경을 복원한다", async () => {
    markOpened("/v/a.md", 1000);
    markOpened("/v/b.md", 1000);
    notesMtimes.mockResolvedValue([
      ["/v/a.md", 2000],
      ["/v/b.md", 500],
    ]);
    await syncFromDisk("/v");
    expect([...get(changedNotes)]).toEqual(["/v/a.md"]);
  });

  /** ⚠️ 열람 이력이 있는 경로만 stat 한다 — vault 전체를 stat 하면 기동이 느려진다. */
  it("열람 이력이 있는 경로만 묻는다", async () => {
    markOpened("/v/a.md", 1000);
    notesMtimes.mockResolvedValue([["/v/a.md", 1000]]);
    await syncFromDisk("/v");
    expect(notesMtimes).toHaveBeenCalledWith("/v", ["/v/a.md"]);
  });

  it("이력이 없으면 아예 안 묻는다", async () => {
    await syncFromDisk("/v");
    expect(notesMtimes).not.toHaveBeenCalled();
  });

  /** ⚠️ 사라진 노트의 이력을 안 지우면 localStorage 가 단조 증가한다. */
  it("사라진 노트의 이력을 정리한다", async () => {
    markOpened("/v/a.md", 1000);
    markOpened("/v/gone.md", 1000);
    notesMtimes.mockResolvedValue([["/v/a.md", 1000]]);
    await syncFromDisk("/v");
    expect(Object.keys(peekLastOpened())).toEqual(["/v/a.md"]);
  });

  /** 실패해도 앱 기능에는 영향이 없다 — 표시만 안 될 뿐. */
  it("실패해도 던지지 않는다", async () => {
    markOpened("/v/a.md", 1000);
    notesMtimes.mockRejectedValue(new Error("boom"));
    await expect(syncFromDisk("/v")).resolves.toBeUndefined();
  });
});

describe("저장값 손상", () => {
  /** 깨진 JSON 이 있어도 앱은 떠야 한다 — 표시만 비면 된다. */
  it("깨진 이력은 빈 상태로 떨어진다", async () => {
    localStorage.setItem("lapis.last-opened", "{{{");
    vi.resetModules();
    const mod = await import("./unread");
    expect(Object.keys(mod.peekLastOpened())).toEqual([]);
  });
});
