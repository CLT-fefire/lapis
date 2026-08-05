import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

/**
 * restorePaneState의 **스키마 마이그레이션** 회귀 방지 (PR-4, 2026-08-05).
 *
 * `lapis.pane-state`에 context 필드가 추가됐다. 구 스키마(필드 없음)를 읽어도
 * 컨텍스트 패널이 펼침으로 떨어져야 하고, Editor/Preview 동시 접힘 가드는
 * context와 **독립**으로 동작해야 한다.
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

describe("restorePaneState — pane 스키마 마이그레이션", () => {
  it("구 스키마(context 필드 없음) → 컨텍스트 패널은 펼침", async () => {
    installLocalStorage({ [PANE_KEY]: JSON.stringify({ editor: true, preview: false }) });
    const m = await loadLayout();
    m.restorePaneState();

    expect(get(m.editorCollapsed)).toBe(true);
    expect(get(m.previewCollapsed)).toBe(false);
    expect(get(m.contextCollapsed)).toBe(false); // 신규 패널 기본 = 펼침
  });

  it("신 스키마 → context 접힘까지 그대로 복원", async () => {
    installLocalStorage({
      [PANE_KEY]: JSON.stringify({ editor: false, preview: true, context: true }),
    });
    const m = await loadLayout();
    m.restorePaneState();

    expect(get(m.previewCollapsed)).toBe(true);
    expect(get(m.contextCollapsed)).toBe(true);
  });

  it("손상 상태(Editor+Preview 동시 접힘)는 거부하되 context는 독립 복원", async () => {
    const store = installLocalStorage({
      [PANE_KEY]: JSON.stringify({ editor: true, preview: true, context: true }),
    });
    const m = await loadLayout();
    m.restorePaneState();

    // 가드: 둘 다 접힌 상태는 복원하지 않고 키를 버린다
    expect(get(m.editorCollapsed)).toBe(false);
    expect(get(m.previewCollapsed)).toBe(false);
    expect(store.has(PANE_KEY)).toBe(false);
    // context는 그 가드와 무관하게 살아남아야 한다
    expect(get(m.contextCollapsed)).toBe(true);
  });

  it("깨진 JSON이면 키를 버리고 기본값 유지", async () => {
    const store = installLocalStorage({ [PANE_KEY]: "{not json" });
    const m = await loadLayout();
    m.restorePaneState();

    expect(get(m.editorCollapsed)).toBe(false);
    expect(get(m.contextCollapsed)).toBe(false);
    expect(store.has(PANE_KEY)).toBe(false);
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

describe("toggleContext — Editor/Preview 가드와 독립", () => {
  it("Editor가 접혀 있어도 컨텍스트는 자유롭게 토글된다", async () => {
    installLocalStorage();
    const m = await loadLayout();
    m.toggleEditor(); // editor 접힘
    expect(get(m.editorCollapsed)).toBe(true);

    m.toggleContext();
    expect(get(m.contextCollapsed)).toBe(true);
    m.toggleContext();
    expect(get(m.contextCollapsed)).toBe(false);
    // 컨텍스트 토글이 Editor 상태를 건드리지 않아야 한다
    expect(get(m.editorCollapsed)).toBe(true);
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
