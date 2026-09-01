import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount } from "svelte";
import { writable } from "svelte/store";
import { installAnimateStub, flushFrames } from "./testHarness/animateStub";
import type { PaletteResult } from "./palette";

/**
 * 명령 팔레트 — **그리는 쪽.**
 *
 * ## 🔴 왜 필요했나
 *
 * `palette.ts`(질의·그룹핑)와 `searchIndex.ts`(fuzzy·초성)는 덮여 있었는데 **그 결과를
 * 그리는 쪽**은 아무도 안 봤다. 팔레트는 이 앱에서 가장 많이 열리는 화면이고,
 * 여기서 틀리면 "검색이 안 된다"로 보인다.
 *
 * ## ⚠️ 무엇을 흉내내고 무엇을 안 흉내내나
 *
 * `unifiedSearch` 만 대신한다 — 그건 이미 `palette.ts` 테스트가 덮고 있고, 스토어
 * 여럿(태그 인덱스·빠른 항목)을 안에서 읽어서 여기서 세우면 그 스토어들을 다 지어야 한다.
 *
 * 🔴 **`groupResults` 는 진짜를 쓴다.** 그룹 나누기·표시 순서는 여기서 재는 대상이다.
 * 그것까지 흉내내면 "망가진 컴포넌트가 기대하던 모양"을 재게 된다.
 */

installAnimateStub();

const paletteOpen = writable(false);
const paletteHintMode = writable<string>("all");
const paletteIntent = writable<string | null>(null);
const paletteScope = writable<string | null>(null);
const savedSearches = writable<unknown[]>([]);
const fullTextIndexReady = writable(true);
const indexBuilding = writable(false);
const fullTextLoading = writable(false);
const pendingFullTextVault = writable<string | null>(null);

const closePalette = vi.fn();
const setPaletteMode = vi.fn((m: string) => paletteHintMode.set(m));
const setPaletteScope = vi.fn();
const selectNote = vi.fn();
const unifiedSearch = vi.fn<(q: string, h: string) => Promise<PaletteResult[]>>();

vi.mock("$lib/stores/palette", () => ({
  paletteOpen,
  paletteHintMode,
  paletteIntent,
  paletteScope,
  savedSearches,
  closePalette: () => closePalette(),
  setPaletteMode: (m: string) => setPaletteMode(m),
  setPaletteScope: (...a: unknown[]) => setPaletteScope(...a),
  saveSearch: () => {},
  removeSavedSearch: () => {},
}));
vi.mock("$lib/stores/search", () => ({
  fullTextIndexReady,
  indexBuilding,
  fullTextLoading,
  pendingFullTextVault,
}));
vi.mock("$lib/stores/vault", () => ({
  selectNote: (...a: unknown[]) => selectNote(...a),
  ensureFullTextIndex: async () => {},
}));
vi.mock("$lib/stores/tags", () => ({ selectTag: () => {}, showTagsTab: () => {} }));
vi.mock("$lib/stores/filters", () => ({ toggleDocKind: () => {}, toggleTopic: () => {} }));
vi.mock("$lib/tauri/notes", () => ({ readNote: async () => "" }));
vi.mock("$lib/stores/usage", () => ({ logWarn: () => {}, logCommand: () => {}, logQuery: () => {} }));

// 🔴 **컴포넌트가 실제로 부르는 것**만 대신한다. 그룹핑·가시성 판정은 진짜를 쓴다.
//
// ⚠️ 예전엔 `unifiedSearch` 를 가로챘는데, 컴포넌트가 `unifiedSearchWithFallback` 로
//    옮겨가자 **가짜가 안 불리고 진짜가 돌아** 결과가 조용히 빈 배열이 됐다. 모듈 안의
//    호출은 mock 을 안 탄다 — 가로챌 것은 언제나 **경계에서 불리는 이름**이다.
vi.mock("$lib/palette", async () => {
  const real = await vi.importActual<typeof import("./palette")>("./palette");
  return {
    ...real,
    unifiedSearchWithFallback: async (q: string, h: string) => ({ results: await unifiedSearch(q, h) }),
  };
});

const Palette = (await import("./CommandPalette.svelte")).default;

const noteResult = (path: string, label: string): PaletteResult => ({
  entry: { kind: "note", path, label },
  score: 1,
});

let target: HTMLElement;
let app: Record<string, unknown> | null = null;
const show = async () => {
  app = mount(Palette, { target }) as Record<string, unknown>;
  await flushFrames(2);
};
const rows = () => [...target.querySelectorAll(".result")];

beforeEach(() => {
  paletteOpen.set(true);
  paletteHintMode.set("all");
  paletteIntent.set(null);
  paletteScope.set(null);
  savedSearches.set([]);
  fullTextIndexReady.set(true);
  indexBuilding.set(false);
  fullTextLoading.set(false);
  pendingFullTextVault.set(null);
  unifiedSearch.mockReset().mockResolvedValue([]);
  for (const f of [closePalette, setPaletteMode, setPaletteScope, selectNote]) f.mockClear();
  document.body.replaceChildren();
  target = document.createElement("div");
  document.body.appendChild(target);
});

afterEach(async () => {
  if (app) void unmount(app);
  app = null;
  await flushFrames(1);
});

describe("안 열렸을 때", () => {
  it("아무것도 안 그린다", async () => {
    paletteOpen.set(false);
    await show();
    expect(target.querySelector(".modal")).toBeNull();
  });
});

describe("열렸을 때", () => {
  it("입력 칸과 모드 탭이 있다", async () => {
    await show();
    expect(target.querySelector(".palette-input")).not.toBeNull();
    expect(target.querySelectorAll(".mode").length).toBeGreaterThan(1);
  });

  /** ⚠️ 지금 어느 모드인지 안 보이면 "검색이 왜 이러지"가 된다. */
  it("지금 모드에 표시가 붙는다", async () => {
    await show();
    const active = [...target.querySelectorAll(".mode.active")];
    expect(active).toHaveLength(1);
  });

  it("모드 탭을 누르면 모드를 바꾼다", async () => {
    await show();
    const other = [...target.querySelectorAll<HTMLButtonElement>(".mode")].find(
      (e) => !e.classList.contains("active"),
    )!;
    other.click();
    expect(setPaletteMode).toHaveBeenCalled();
  });

  it("배경을 누르면 닫는다", async () => {
    await show();
    target.querySelector<HTMLElement>(".backdrop")!.click();
    expect(closePalette).toHaveBeenCalled();
  });
});

describe("결과", () => {
  it("결과 줄을 그린다", async () => {
    unifiedSearch.mockResolvedValue([noteResult("/v/a.md", "가"), noteResult("/v/b.md", "나")]);
    await show();
    expect(rows().map((e) => e.querySelector(".title")?.textContent?.trim())).toEqual(["가", "나"]);
  });

  /** ⚠️ 어디에 있는지 안 보이면 화살표로 움직여도 감이 안 온다. */
  it("첫 줄이 활성이다", async () => {
    unifiedSearch.mockResolvedValue([noteResult("/v/a.md", "가"), noteResult("/v/b.md", "나")]);
    await show();
    expect(rows()[0].classList.contains("active")).toBe(true);
    expect(target.querySelectorAll(".result.active")).toHaveLength(1);
  });

  it("누르면 그 노트를 연다", async () => {
    unifiedSearch.mockResolvedValue([noteResult("/v/a.md", "가")]);
    await show();
    rows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushFrames(1);
    expect(selectNote).toHaveBeenCalled();
  });

  it("결과가 없으면 줄도 없다", async () => {
    unifiedSearch.mockResolvedValue([]);
    await show();
    expect(rows()).toHaveLength(0);
  });
});

/**
 * 🔴 **상태를 말한다.** 인덱스를 만드는 중인데 아무 말이 없으면 사용자는 "검색이 고장났다"고
 * 읽는다 — 빈 결과와 "아직 준비 중"은 화면에서 구별돼야 한다.
 */
describe("상태 문구", () => {
  it("인덱스를 만드는 중이면 말한다", async () => {
    indexBuilding.set(true);
    await show();
    expect(target.querySelector(".status")).not.toBeNull();
  });
});

describe("스코프", () => {
  it("스코프가 없으면 바가 없다", async () => {
    await show();
    expect(target.querySelector(".scope-bar")).toBeNull();
  });

  it("스코프가 있으면 이름과 해제 버튼이 뜬다", async () => {
    paletteScope.set("knowledge/lapis/");
    await show();
    expect(target.querySelector(".scope-label")?.textContent?.trim()).toBe("knowledge/lapis");
    target.querySelector<HTMLButtonElement>(".scope-clear")!.click();
    expect(setPaletteScope).toHaveBeenCalled();
  });
});
