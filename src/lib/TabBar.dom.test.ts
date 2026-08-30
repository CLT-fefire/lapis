import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount } from "svelte";
import { writable } from "svelte/store";
import { installAnimateStub, flushFrames } from "./testHarness/animateStub";

/**
 * 탭 바 — **그리는 쪽.**
 *
 * ## 🔴 왜 필요했나
 *
 * 탭 복원(`lapis.open-tabs`)과 핀 스토어는 덮여 있었는데 **그걸 그리는 쪽**은 아무도
 * 안 봤다. 탭은 화면에서 가장 많이 눌리는 자리고, 여기서 틀리면 "어느 노트를 보고
 * 있는지"가 어긋난다.
 *
 * ⚠️ 밑줄은 탭마다가 아니라 **전체에 하나**다. 측정에 실패하면 `width: 0` 이라
 * 아무것도 안 그린다 — 틀린 자리에 줄이 남는 것보다 낫다. happy-dom 은 레이아웃을
 * 재지 않으므로 밑줄의 **자리**는 여기서 못 잰다. 있다는 것만 본다.
 */

installAnimateStub();

const openTabs = writable<string[]>([]);
const currentNotePath = writable<string | null>(null);
const isDirty = writable(false);
const pinnedNotePaths = writable<string[]>([]);

const selectNote = vi.fn();
const closeTab = vi.fn();
const moveTab = vi.fn();
const closeOtherTabs = vi.fn();
const closeTabsToRight = vi.fn();
const togglePin = vi.fn();
const logCommand = vi.fn();
const revealInFinder = vi.fn();

vi.mock("$lib/stores/tabs", () => ({ openTabs }));
vi.mock("$lib/stores/vault", () => ({
  currentNotePath,
  selectNote: (...a: unknown[]) => selectNote(...a),
  closeTab: (...a: unknown[]) => closeTab(...a),
  moveTab: (...a: unknown[]) => moveTab(...a),
  closeOtherTabs: (...a: unknown[]) => closeOtherTabs(...a),
  closeTabsToRight: (...a: unknown[]) => closeTabsToRight(...a),
}));
vi.mock("$lib/stores/editor", () => ({ isDirty }));
vi.mock("$lib/stores/pins", () => ({
  pinnedNotePaths,
  togglePin: (...a: unknown[]) => togglePin(...a),
}));
vi.mock("$lib/stores/usage", () => ({ logCommand: (...a: unknown[]) => logCommand(...a) }));
vi.mock("$lib/tauri/reveal", () => ({ revealInFinder: (...a: unknown[]) => revealInFinder(...a) }));

const TabBar = (await import("./TabBar.svelte")).default;

let target: HTMLElement;
let app: Record<string, unknown> | null = null;
const show = () => {
  app = mount(TabBar, { target }) as Record<string, unknown>;
};
const tabs = () => [...target.querySelectorAll(".tab")];
const labels = () => [...target.querySelectorAll(".tab .label")].map((e) => e.textContent?.trim());

beforeEach(() => {
  openTabs.set([]);
  currentNotePath.set(null);
  isDirty.set(false);
  pinnedNotePaths.set([]);
  for (const f of [selectNote, closeTab, moveTab, togglePin, logCommand]) f.mockClear();
  document.body.replaceChildren();
  target = document.createElement("div");
  document.body.appendChild(target);
});

afterEach(async () => {
  if (app) void unmount(app);
  app = null;
  await flushFrames(1);
});

describe("탭이 없을 때", () => {
  /** ⚠️ 빈 바를 그리면 화면에 쓸모없는 줄이 남는다. */
  it("바 자체를 안 그린다", () => {
    show();
    expect(target.querySelector(".tab-bar")).toBeNull();
  });
});

describe("탭을 그린다", () => {
  beforeEach(() => openTabs.set(["/v/a.md", "/v/sub/b.md"]));

  /** ⚠️ 라벨은 **파일 이름의 stem** 이다 — 경로 전체를 쓰면 탭이 화면을 다 먹는다. */
  it("stem 을 라벨로 쓴다", () => {
    show();
    expect(labels()).toEqual(["a", "b"]);
  });

  it("전체 경로는 title 로만 남긴다", () => {
    show();
    expect(tabs()[1].getAttribute("title")).toBe("/v/sub/b.md");
  });

  it("지금 보는 탭을 표시한다", () => {
    currentNotePath.set("/v/sub/b.md");
    show();
    expect(tabs()[1].classList.contains("active")).toBe(true);
    expect(tabs()[0].classList.contains("active")).toBe(false);
  });

  /** 접근성 — 낭독기는 클래스가 아니라 `aria-selected` 를 읽는다. */
  it("aria-selected 도 같이 붙는다", () => {
    currentNotePath.set("/v/a.md");
    show();
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs()[1].getAttribute("aria-selected")).toBe("false");
  });

  it("누르면 그 노트를 연다", () => {
    show();
    tabs()[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(selectNote).toHaveBeenCalled();
  });

  it("✕ 는 닫기지 열기가 아니다", () => {
    show();
    target.querySelectorAll<HTMLButtonElement>(".tab .close")[0].click();
    expect(closeTab).toHaveBeenCalledWith("/v/a.md");
    expect(selectNote, "닫으면서 열기까지 했다").not.toHaveBeenCalled();
  });
});

describe("핀", () => {
  beforeEach(() => openTabs.set(["/v/a.md", "/v/b.md"]));

  it("핀 여부가 별 모양으로 나온다", () => {
    pinnedNotePaths.set(["/v/b.md"]);
    show();
    const stars = [...target.querySelectorAll(".pin-icon")].map((e) => e.textContent?.trim());
    expect(stars).toEqual(["☆", "★"]);
  });

  it("핀 상태가 클래스에도 붙는다", () => {
    pinnedNotePaths.set(["/v/b.md"]);
    show();
    expect(tabs()[1].classList.contains("pinned")).toBe(true);
  });

  /** ⚠️ 토글 버튼은 `aria-pressed` 로 상태를 말해야 한다 — 별 모양은 낭독기가 못 읽는다. */
  it("aria-pressed 로도 말한다", () => {
    pinnedNotePaths.set(["/v/a.md"]);
    show();
    expect(target.querySelectorAll(".pin-icon")[0].getAttribute("aria-pressed")).toBe("true");
  });

  it("누르면 토글하고 탭은 안 바뀐다", () => {
    show();
    target.querySelectorAll<HTMLButtonElement>(".pin-icon")[0].click();
    expect(togglePin).toHaveBeenCalledWith("/v/a.md");
    expect(selectNote, "핀을 누르니 탭까지 옮겨 갔다").not.toHaveBeenCalled();
  });
});

/**
 * 🔴 **안 저장된 표시는 지금 보는 탭에만 붙는다.** 편집기는 하나뿐이라 `isDirty` 도
 * 하나다 — 모든 탭에 붙이면 안 건드린 노트까지 안 저장된 것처럼 보인다.
 */
describe("안 저장 표시", () => {
  beforeEach(() => {
    openTabs.set(["/v/a.md", "/v/b.md"]);
    currentNotePath.set("/v/a.md");
  });

  it("깨끗하면 안 붙는다", () => {
    show();
    expect(target.querySelector(".dirty")).toBeNull();
  });

  it("더러우면 활성 탭에만 붙는다", () => {
    isDirty.set(true);
    show();
    expect(target.querySelectorAll(".dirty")).toHaveLength(1);
    expect(tabs()[0].querySelector(".dirty")).not.toBeNull();
  });
});

describe("밑줄", () => {
  /**
   * ⚠️ 탭마다 하나가 아니라 **전체에 하나**다. 탭마다 그리면 전환이 "꺼지고 켜진다"가
   * 되는데, 모션 명세는 밑줄이 **미끄러진다**고 정한다.
   *
   * ⚠️ 자리는 happy-dom 이 레이아웃을 안 재서 여기서 못 잰다. 개수만 본다.
   */
  it("탭이 몇 개든 밑줄은 하나다", () => {
    openTabs.set(["/v/a.md", "/v/b.md", "/v/c.md"]);
    show();
    expect(target.querySelectorAll(".underline")).toHaveLength(1);
  });

  it("장식이므로 낭독기에서 숨긴다", () => {
    openTabs.set(["/v/a.md"]);
    show();
    expect(target.querySelector(".underline")?.getAttribute("aria-hidden")).toBe("true");
  });
});
