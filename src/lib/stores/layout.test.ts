import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

/**
 * restorePaneState의 **스키마 마이그레이션** 회귀 방지.
 *
 * `lapis.pane-state`는 두 번 바뀌었다:
 *   ① 2026-08-05 (PR-4) — context 필드 추가. 구 스키마엔 없다.
 *   ② 2026-08-10 — split 제거. `{editor, preview}` boolean 2개 → `pane` enum 1개.
 *
 * ②가 잃는 정보가 있다(split → 읽기로 접힘). 사용자의 실제 localStorage는 다음 실행에
 * 새 스키마로 덮여 **한 번만** 변환되므로, 여기서 구 스키마 4조합을 전부 못 박는다.
 *
 * store가 모듈 스코프 싱글톤이라 케이스마다 resetModules + 동적 import로 격리한다.
 */

const PANE_KEY = "lapis.pane-state";
const CONTEXT_WIDTH_KEY = "lapis.context-width";

function installLocalStorage(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  const mock = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  vi.stubGlobal("localStorage", mock);
  return store;
}

async function loadLayout() {
  vi.resetModules();
  return await import("./layout");
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("restorePaneState — 구 스키마(접기 2비트) → mainPane", () => {
  it("Editor 접힘 → 읽기", async () => {
    installLocalStorage({ [PANE_KEY]: JSON.stringify({ editor: true, preview: false }) });
    const m = await loadLayout();
    m.restorePaneState();

    expect(get(m.mainPane)).toBe("preview");
    expect(get(m.contextCollapsed)).toBe(false); // context 필드 없는 더 옛 스키마 = 펼침
  });

  it("Preview 접힘 → 편집 (context 접힘도 함께 복원)", async () => {
    installLocalStorage({
      [PANE_KEY]: JSON.stringify({ editor: false, preview: true, context: true }),
    });
    const m = await loadLayout();
    m.restorePaneState();

    expect(get(m.mainPane)).toBe("editor");
    expect(get(m.contextCollapsed)).toBe(true);
  });

  it("split(둘 다 펼침) → 읽기 — 새 모델에 split이 없다", async () => {
    installLocalStorage({
      [PANE_KEY]: JSON.stringify({ editor: false, preview: false, context: false }),
    });
    const m = await loadLayout();
    m.restorePaneState();

    expect(get(m.mainPane)).toBe("preview");
  });

  it("손상 상태(둘 다 접힘)도 읽기로 떨구고 context는 독립 복원", async () => {
    installLocalStorage({
      [PANE_KEY]: JSON.stringify({ editor: true, preview: true, context: true }),
    });
    const m = await loadLayout();
    m.restorePaneState();

    expect(get(m.mainPane)).toBe("preview");
    expect(get(m.contextCollapsed)).toBe(true);
  });

  it("구 스키마를 읽으면 새 스키마로 즉시 덮어써 변환이 1회로 끝난다", async () => {
    const store = installLocalStorage({
      [PANE_KEY]: JSON.stringify({ editor: false, preview: true, context: true }),
    });
    const m = await loadLayout();
    m.restorePaneState();

    expect(JSON.parse(store.get(PANE_KEY)!)).toEqual({ pane: "editor", context: true });
  });

  it("신 스키마는 그대로 복원하고 다시 쓰지 않는다", async () => {
    const store = installLocalStorage({
      [PANE_KEY]: JSON.stringify({ pane: "editor", context: true }),
    });
    const m = await loadLayout();
    m.restorePaneState();

    expect(get(m.mainPane)).toBe("editor");
    expect(get(m.contextCollapsed)).toBe(true);
    expect(JSON.parse(store.get(PANE_KEY)!)).toEqual({ pane: "editor", context: true });
  });

  it("깨진 JSON이면 키를 버리고 기본값 유지", async () => {
    const store = installLocalStorage({ [PANE_KEY]: "{not json" });
    const m = await loadLayout();
    m.restorePaneState();

    expect(get(m.mainPane)).toBe("preview");
    expect(get(m.contextCollapsed)).toBe(false);
    expect(store.has(PANE_KEY)).toBe(false);
  });
});

describe("mainPane 토글", () => {
  it("저장값이 없으면 읽기로 시작한다 (읽기·탐색이 주 용도)", async () => {
    installLocalStorage(); // pane-state 없음 = 신규 설치
    const m = await loadLayout();
    m.restorePaneState();

    expect(get(m.mainPane)).toBe("preview");
    expect(get(m.contextCollapsed)).toBe(false);
  });

  it("toggleMainPane — 왕복하며 매번 영속화", async () => {
    const store = installLocalStorage();
    const m = await loadLayout();

    m.toggleMainPane();
    expect(get(m.mainPane)).toBe("editor");
    expect(JSON.parse(store.get(PANE_KEY)!).pane).toBe("editor");

    m.toggleMainPane();
    expect(get(m.mainPane)).toBe("preview");
    expect(JSON.parse(store.get(PANE_KEY)!).pane).toBe("preview");
  });

  it("setMainPane — 같은 값이면 쓰지 않는다", async () => {
    const store = installLocalStorage();
    const m = await loadLayout();

    m.setMainPane("preview"); // 이미 preview
    expect(store.has(PANE_KEY)).toBe(false);

    m.setMainPane("editor");
    expect(get(m.mainPane)).toBe("editor");
    expect(JSON.parse(store.get(PANE_KEY)!).pane).toBe("editor");
  });

  it("resetLayout — 신규 설치와 같은 상태로 되돌리고 영속화", async () => {
    const store = installLocalStorage();
    const m = await loadLayout();
    m.toggleMainPane();
    m.toggleSidebar();
    m.toggleContext();
    m.setSidebarWidth(500);

    m.resetLayout();

    expect(get(m.mainPane)).toBe("preview");
    expect(get(m.contextCollapsed)).toBe(false);
    expect(get(m.sidebarCollapsed)).toBe(false);
    expect(get(m.sidebarWidth)).toBe(m.DEFAULT_SIDEBAR_WIDTH);
    expect(get(m.contextWidth)).toBe(m.DEFAULT_CONTEXT_WIDTH);
    expect(JSON.parse(store.get(PANE_KEY)!)).toEqual({
      pane: "preview",
      context: false,
    });
  });
});

describe("컨텍스트 패널 폭", () => {
  it("저장값을 [MIN, MAX]로 클램프해 복원", async () => {
    installLocalStorage({ [CONTEXT_WIDTH_KEY]: "9999" });
    const m = await loadLayout();
    m.restorePaneState();
    expect(get(m.contextWidth)).toBe(m.MAX_CONTEXT_WIDTH);
  });

  it("setContextWidth — 하한 클램프 + 영속", async () => {
    const store = installLocalStorage();
    const m = await loadLayout();
    m.setContextWidth(10);
    expect(get(m.contextWidth)).toBe(m.MIN_CONTEXT_WIDTH);
    expect(store.get(CONTEXT_WIDTH_KEY)).toBe(String(m.MIN_CONTEXT_WIDTH));
  });

  it("숫자가 아니면 키를 버리고 기본값 유지", async () => {
    const store = installLocalStorage({ [CONTEXT_WIDTH_KEY]: "wide" });
    const m = await loadLayout();
    m.restorePaneState();
    expect(get(m.contextWidth)).toBe(m.DEFAULT_CONTEXT_WIDTH);
    expect(store.has(CONTEXT_WIDTH_KEY)).toBe(false);
  });
});

describe("toggleContext — 본문 페인과 독립", () => {
  it("편집 모드에서도 컨텍스트는 자유롭게 토글된다", async () => {
    installLocalStorage();
    const m = await loadLayout();
    m.setMainPane("editor");

    m.toggleContext();
    expect(get(m.contextCollapsed)).toBe(true);
    m.toggleContext();
    expect(get(m.contextCollapsed)).toBe(false);
    // 컨텍스트 토글이 본문 페인 모드를 건드리지 않아야 한다
    expect(get(m.mainPane)).toBe("editor");
  });

  it("expandContext는 접힘일 때만 동작(펼침이면 no-op)", async () => {
    installLocalStorage();
    const m = await loadLayout();
    m.expandContext();
    expect(get(m.contextCollapsed)).toBe(false);

    m.toggleContext();
    expect(get(m.contextCollapsed)).toBe(true);
    m.expandContext();
    expect(get(m.contextCollapsed)).toBe(false);
  });
});
