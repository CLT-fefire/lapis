import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * 창별 키 스코프. `main`만 **접미사 없는** 원래 키를 쓴다 — 이게 깨지면 기존 사용자의
 * 모든 창이 마지막 vault를 잊는다(빈 "Vault 열기…" 화면으로 시작).
 *
 * `windowLabel()`이 라벨을 캐시하므로 케이스마다 resetModules로 격리한다.
 */

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

/** Tauri window API를 라벨 하나로 대역. */
async function loadScope(label: string) {
  vi.resetModules();
  vi.doMock("@tauri-apps/api/window", () => ({
    getCurrentWindow: () => ({ label }),
  }));
  return await import("./windowScope");
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("@tauri-apps/api/window");
});

describe("scopedKey", () => {
  it("main 창은 접미사 없이 기존 키를 그대로 쓴다", async () => {
    const m = await loadScope("main");
    expect(m.scopedKey("lapis.last-vault-path")).toBe("lapis.last-vault-path");
  });

  it("보조 창은 라벨을 접미사로 붙인다", async () => {
    const m = await loadScope("w2");
    expect(m.scopedKey("lapis.last-vault-path")).toBe("lapis.last-vault-path.w2");
  });

  it("Tauri 밖(브라우저 미리보기·테스트)에서는 main으로 떨어진다", async () => {
    vi.resetModules();
    vi.doMock("@tauri-apps/api/window", () => ({
      getCurrentWindow: () => {
        throw new Error("not in tauri");
      },
    }));
    const m = await import("./windowScope");
    expect(m.windowLabel()).toBe("main");
    expect(m.scopedKey("x")).toBe("x");
  });
});

describe("pruneOrphanScopedKeys", () => {
  it("main 창이 지난 실행에서 남은 보조 창 키를 걷어낸다", async () => {
    const store = installLocalStorage({
      "lapis.last-vault-path": "/vault/a",
      "lapis.last-vault-path.w2": "/vault/b",
      "lapis.last-vault-path.w3": "/vault/c",
      "lapis.theme": "dark",
    });
    const m = await loadScope("main");
    m.pruneOrphanScopedKeys("lapis.last-vault-path");

    expect(store.get("lapis.last-vault-path")).toBe("/vault/a"); // 자기 것은 유지
    expect(store.has("lapis.last-vault-path.w2")).toBe(false);
    expect(store.has("lapis.last-vault-path.w3")).toBe(false);
    expect(store.get("lapis.theme")).toBe("dark"); // 무관한 키는 건드리지 않는다
  });

  it("보조 창은 청소하지 않는다 — 살아 있는 형제 창의 키를 지울 수 있다", async () => {
    const store = installLocalStorage({
      "lapis.last-vault-path.w2": "/vault/b",
      "lapis.last-vault-path.w3": "/vault/c",
    });
    const m = await loadScope("w2");
    m.pruneOrphanScopedKeys("lapis.last-vault-path");

    expect(store.has("lapis.last-vault-path.w2")).toBe(true);
    expect(store.has("lapis.last-vault-path.w3")).toBe(true);
  });
});
