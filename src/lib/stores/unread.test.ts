import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

/**
 * "안 본 사이 바뀐 노트" 판정 회귀 방지 (PR-11, 2026-08-05).
 *
 * 핵심 규칙 두 가지를 고정한다:
 *  1. **한 번도 안 연 노트는 대상이 아니다** — 12000개가 전부 볼드면 신호가 죽는다.
 *  2. 노트를 열면 그 시점이 새 기준 — 표시가 해제된다.
 */

const LAST_OPENED_KEY = "lapis.last-opened";

function installLocalStorage(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });
  return store;
}

/** notesMtimes(IPC)를 고정 응답으로 대체. */
function mockMtimes(rows: [string, number][]) {
  vi.doMock("$lib/tauri/notes", () => ({
    notesMtimes: vi.fn(async () => rows),
  }));
}

async function loadUnread() {
  vi.resetModules();
  return await import("./unread");
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("$lib/tauri/notes");
});

describe("markChangedFromWatcher", () => {
  it("한 번도 안 연 노트는 **무시** — 전부 볼드가 되면 신호가 죽는다", async () => {
    installLocalStorage();
    const m = await loadUnread();
    m.markChangedFromWatcher("/v/never-opened.md", Date.now());
    expect(get(m.changedNotes).size).toBe(0);
  });

  it("열람 이후 수정이면 표시", async () => {
    installLocalStorage({ [LAST_OPENED_KEY]: JSON.stringify({ "/v/a.md": 1000 }) });
    const m = await loadUnread();
    m.markChangedFromWatcher("/v/a.md", 2000);
    expect(get(m.changedNotes).has("/v/a.md")).toBe(true);
  });

  it("열람 시각보다 이전·같은 mtime이면 무시", async () => {
    installLocalStorage({ [LAST_OPENED_KEY]: JSON.stringify({ "/v/a.md": 2000 }) });
    const m = await loadUnread();
    m.markChangedFromWatcher("/v/a.md", 2000); // 동일
    m.markChangedFromWatcher("/v/a.md", 1500); // 과거
    expect(get(m.changedNotes).size).toBe(0);
  });
});

describe("markOpened", () => {
  it("열면 표시가 해제되고 기준 시각이 갱신된다", async () => {
    installLocalStorage({ [LAST_OPENED_KEY]: JSON.stringify({ "/v/a.md": 1000 }) });
    const m = await loadUnread();
    m.markChangedFromWatcher("/v/a.md", 2000);
    expect(get(m.changedNotes).has("/v/a.md")).toBe(true);

    m.markOpened("/v/a.md", 3000);
    expect(get(m.changedNotes).has("/v/a.md")).toBe(false);
    expect(m.peekLastOpened()["/v/a.md"]).toBe(3000);

    // 새 기준(3000) 이하의 변경은 다시 표시되지 않는다
    m.markChangedFromWatcher("/v/a.md", 2500);
    expect(get(m.changedNotes).has("/v/a.md")).toBe(false);
  });

  it("처음 여는 노트도 이력에 기록된다(이후 변경 추적 대상이 됨)", async () => {
    installLocalStorage();
    const m = await loadUnread();
    m.markOpened("/v/new.md", 500);
    expect(m.peekLastOpened()["/v/new.md"]).toBe(500);

    m.markChangedFromWatcher("/v/new.md", 900);
    expect(get(m.changedNotes).has("/v/new.md")).toBe(true);
  });
});

describe("syncFromDisk", () => {
  it("열람 이후 mtime이 큰 것만 표시", async () => {
    installLocalStorage({
      [LAST_OPENED_KEY]: JSON.stringify({ "/v/a.md": 1000, "/v/b.md": 5000 }),
    });
    mockMtimes([
      ["/v/a.md", 2000], // 변경됨
      ["/v/b.md", 4000], // 안 바뀜(열람이 더 최근)
    ]);
    const m = await loadUnread();
    await m.syncFromDisk("/v");

    expect(get(m.changedNotes).has("/v/a.md")).toBe(true);
    expect(get(m.changedNotes).has("/v/b.md")).toBe(false);
  });

  it("사라진 노트의 열람 이력은 정리한다 — 안 그러면 단조 증가", async () => {
    installLocalStorage({
      [LAST_OPENED_KEY]: JSON.stringify({ "/v/a.md": 1000, "/v/gone.md": 1000 }),
    });
    mockMtimes([["/v/a.md", 1500]]); // gone.md는 응답에서 빠짐(삭제됨)
    const m = await loadUnread();
    await m.syncFromDisk("/v");

    expect(m.peekLastOpened()).toEqual({ "/v/a.md": 1000 });
  });

  it("열람 이력이 비어 있으면 IPC를 부르지 않는다", async () => {
    installLocalStorage();
    const spy = vi.fn(async () => [] as [string, number][]);
    vi.doMock("$lib/tauri/notes", () => ({ notesMtimes: spy }));
    const m = await loadUnread();
    await m.syncFromDisk("/v");
    expect(spy).not.toHaveBeenCalled();
  });

  it("IPC 실패해도 던지지 않는다 — 표시만 빠질 뿐 기능은 산다", async () => {
    installLocalStorage({ [LAST_OPENED_KEY]: JSON.stringify({ "/v/a.md": 1000 }) });
    vi.doMock("$lib/tauri/notes", () => ({
      notesMtimes: vi.fn(async () => {
        throw new Error("ipc down");
      }),
    }));
    const m = await loadUnread();
    await expect(m.syncFromDisk("/v")).resolves.toBeUndefined();
  });
});
