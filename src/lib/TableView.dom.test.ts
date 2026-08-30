import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount } from "svelte";
import { writable } from "svelte/store";
import { installAnimateStub, flushFrames } from "./testHarness/animateStub";
import type { LinkInfo } from "./tauri/notes";

/**
 * 한눈에 보기(표) — **그리는 쪽.**
 *
 * ## 🔴 왜 필요했나
 *
 * `tableView.ts`(정렬·거르기)는 덮여 있었는데 **표를 그리는 쪽**은 아무도 안 봤다.
 * 그런데 v3.5.2 에서 프리뷰로 **실제로 정렬해 보고 결함 넷**이 나왔다 — 순수 함수
 * 테스트도 배선 가드도 전부 초록인 상태에서:
 *
 * - 내림차순에서 빈 칸이 맨 위로 (같은 규칙이 두 군데, 한쪽만 맞음)
 * - 표 머리글에 `tabindex` 도 컨트롤도 없어 **키보드로 정렬에 닿을 방법이 아예 없었다**
 * - `aria-sort` 없음 (화살표는 그리고 있었다)
 *
 * 그래서 여기서는 **정렬 표시와 접근성**을 특히 못 박는다.
 */

installAnimateStub();

const tableViewOpen = writable(false);
const activeColumns = writable<string[]>([]);
const activeSort = writable<{ key: string; dir: "asc" | "desc" } | null>(null);
const activeDocKinds = writable(new Set<string>());
const activeTopics = writable(new Set<string>());
const activeText = writable("");
const renderLimit = writable(100);
const savedViews = writable<unknown[]>([]);
const linkIndex = writable<{ byPath: Map<string, LinkInfo> } | null>(null);
const vaultPath = writable<string | null>("/v");
const docKindCounts = writable(new Map<string, number>());
const topicCounts = writable(new Map<string, number>());

const toggleSort = vi.fn();
const toggleColumn = vi.fn();
const moveColumn = vi.fn();
const closeTableView = vi.fn();
const selectNote = vi.fn();

const noop = () => {};
vi.mock("$lib/stores/tableView", () => ({
  tableViewOpen,
  closeTableView: () => closeTableView(),
  activeColumns,
  activeSort,
  activeDocKinds,
  activeTopics,
  activeText,
  renderLimit,
  RENDER_STEP: 100,
  toggleSort: (k: string) => toggleSort(k),
  toggleColumn: (k: string) => toggleColumn(k),
  moveColumn: (...a: unknown[]) => moveColumn(...a),
  toggleTableDocKind: noop,
  toggleTableTopic: noop,
  clearTableFilters: noop,
  savedViews,
  saveCurrentView: noop,
  applySavedView: noop,
  deleteSavedView: noop,
  showMore: noop,
}));
vi.mock("$lib/stores/vault", () => ({
  linkIndex,
  vaultPath,
  selectNote: (...a: unknown[]) => selectNote(...a),
}));
vi.mock("$lib/stores/filters", () => ({ docKindCounts, topicCounts }));

const TableView = (await import("./TableView.svelte")).default;

function note(path: string, kind: string | null, topic: string | null): LinkInfo {
  return {
    source_path: path,
    source_name: path.split("/").pop() ?? "",
    title: null,
    aliases: [],
    targets: [],
    tags: [],
    doc_kind: kind,
    topic,
    related: [],
    props: {},
  };
}

let target: HTMLElement;
let app: Record<string, unknown> | null = null;
const show = async () => {
  app = mount(TableView, { target }) as Record<string, unknown>;
  await flushFrames(1);
};

beforeEach(() => {
  tableViewOpen.set(true);
  activeColumns.set(["title", "doc_kind"]);
  activeSort.set(null);
  activeDocKinds.set(new Set());
  activeTopics.set(new Set());
  activeText.set("");
  renderLimit.set(100);
  savedViews.set([]);
  vaultPath.set("/v");
  linkIndex.set({
    byPath: new Map([
      ["/v/a.md", note("/v/a.md", "plan", "ui")],
      ["/v/b.md", note("/v/b.md", "adr", "cli")],
    ]),
  });
  docKindCounts.set(new Map([["plan", 1], ["adr", 1]]));
  topicCounts.set(new Map([["ui", 1], ["cli", 1]]));
  for (const f of [toggleSort, toggleColumn, moveColumn, closeTableView, selectNote]) f.mockClear();
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
    tableViewOpen.set(false);
    await show();
    expect(target.querySelector(".modal")).toBeNull();
  });
});

describe("표를 그린다", () => {
  it("고른 컬럼만 머리글로 낸다", async () => {
    await show();
    expect(target.querySelectorAll("thead th")).toHaveLength(2);
  });

  it("노트마다 한 줄", async () => {
    await show();
    expect(target.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("줄을 누르면 그 노트를 연다", async () => {
    await show();
    target.querySelector<HTMLElement>("tbody tr")!.click();
    expect(selectNote).toHaveBeenCalled();
  });

  /** ⚠️ 컬럼이 하나도 없으면 **말한다.** 빈 표는 "노트가 없다"와 구별이 안 된다. */
  it("컬럼이 없으면 그렇다고 말한다", async () => {
    activeColumns.set([]);
    await show();
    expect(target.querySelector(".empty")).not.toBeNull();
    expect(target.querySelector("table")).toBeNull();
  });

  it("맞는 노트가 없어도 말한다", async () => {
    activeText.set("있을 리 없는 글자");
    await show();
    expect(target.querySelector(".empty")).not.toBeNull();
  });
});

/**
 * 🔴 **정렬은 키보드로 닿아야 하고, 상태를 낭독기에도 말해야 한다.**
 * v3.5.2 에서 실제로 둘 다 없었다 — 화살표는 그리면서 `aria-sort` 가 없었고,
 * 머리글에 컨트롤이 없어 키보드로는 정렬 자체가 불가능했다.
 */
describe("정렬", () => {
  it("머리글이 버튼이라 키보드로 닿는다", async () => {
    await show();
    const sorts = target.querySelectorAll("thead .sort");
    expect(sorts.length, "머리글에 컨트롤이 없다 — 키보드로 정렬에 못 닿는다").toBe(2);
    expect(sorts[0].tagName).toBe("BUTTON");
  });

  it("누르면 그 컬럼으로 정렬한다", async () => {
    await show();
    target.querySelectorAll<HTMLButtonElement>("thead .sort")[1].click();
    expect(toggleSort).toHaveBeenCalledWith("doc_kind");
  });

  it("정렬 안 했으면 aria-sort 는 none", async () => {
    await show();
    const th = [...target.querySelectorAll("thead th")].map((e) => e.getAttribute("aria-sort"));
    expect(th).toEqual(["none", "none"]);
  });

  it("오름차순을 aria-sort 로 말한다", async () => {
    activeSort.set({ key: "title", dir: "asc" });
    await show();
    const th = [...target.querySelectorAll("thead th")].map((e) => e.getAttribute("aria-sort"));
    expect(th).toEqual(["ascending", "none"]);
  });

  it("내림차순도 말한다", async () => {
    activeSort.set({ key: "doc_kind", dir: "desc" });
    await show();
    const th = [...target.querySelectorAll("thead th")].map((e) => e.getAttribute("aria-sort"));
    expect(th).toEqual(["none", "descending"]);
  });
});

describe("컬럼 옮기기", () => {
  /** ⚠️ 끝에서는 못 옮긴다 — 눌러도 아무 일이 없으면 고장과 구별이 안 되므로 **끈다.** */
  it("맨 왼쪽은 왼쪽 이동이 꺼져 있다", async () => {
    await show();
    const ops = target.querySelectorAll("thead th")[0].querySelectorAll("button.op");
    expect((ops[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("맨 오른쪽은 오른쪽 이동이 꺼져 있다", async () => {
    await show();
    const ops = target.querySelectorAll("thead th")[1].querySelectorAll("button.op");
    expect((ops[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it("가운데는 양쪽 다 켜져 있다", async () => {
    activeColumns.set(["title", "doc_kind", "topic"]);
    await show();
    const ops = target.querySelectorAll("thead th")[1].querySelectorAll("button.op");
    expect((ops[0] as HTMLButtonElement).disabled).toBe(false);
    expect((ops[1] as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("칩", () => {
  it("고른 축에 표시가 붙는다", async () => {
    activeDocKinds.set(new Set(["plan"]));
    await show();
    const on = [...target.querySelectorAll(".chip.on")].map((e) => e.textContent?.trim());
    expect(on.some((t) => t?.startsWith("plan"))).toBe(true);
  });
});
