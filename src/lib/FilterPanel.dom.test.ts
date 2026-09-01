import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount } from "svelte";
import { writable, get } from "svelte/store";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { LinkInfo } from "./tauri/notes";
import { flushFrames } from "./testHarness/animateStub";

/**
 * 필터 패널 — **그리는 쪽.**
 *
 * ## 🔴 이 컴포넌트가 전례다
 *
 * 필터 칩은 `class:active` 가 제대로 걸려 있었는데 **CSS 에 그 규칙이 없어서**
 * 눌러도 아무 표시가 안 났고, 그 상태로 **두 릴리스가 그냥 나갔다.** 로직 테스트는
 * 전부 초록이었다 — 클래스는 붙고 있었으니까.
 *
 * 그래서 여기서는 클래스만 보지 않고 **CSS 훅이 실제로 있는지**도 같이 본다.
 * 그리고 폴더 축은 v3.5.1 까지 **한 번도 안 떴다**(`scopeOptions` 가 절대경로를 받으면
 * 후보를 하나도 안 냈다) — 그것도 못 박는다.
 */

const docKindCounts = writable(new Map<string, number>());
const topicCounts = writable(new Map<string, number>());
const selectedDocKinds = writable(new Set<string>());
const selectedTopics = writable(new Set<string>());
const selectedFolders = writable(new Set<string>());
const selectedProps = writable(new Map<string, Set<string>>());
const currentNotePath = writable<string | null>(null);
const linkIndex = writable<{ byPath: Map<string, LinkInfo> } | null>(null);

const toggleDocKind = vi.fn((v: string) =>
  selectedDocKinds.update((s) => {
    const n = new Set(s);
    n.has(v) ? n.delete(v) : n.add(v);
    return n;
  }),
);
const toggleTopic = vi.fn();
const toggleFolder = vi.fn();
const togglePropValue = vi.fn();
const clearFilters = vi.fn(() => {
  selectedDocKinds.set(new Set());
  selectedTopics.set(new Set());
  selectedFolders.set(new Set());
  selectedProps.set(new Map());
});
const selectNote = vi.fn();

vi.mock("$lib/stores/filters", () => ({
  docKindCounts,
  topicCounts,
  selectedDocKinds,
  selectedTopics,
  selectedFolders,
  selectedProps,
  toggleDocKind: (v: string) => toggleDocKind(v),
  toggleTopic: (v: string) => toggleTopic(v),
  toggleFolder: (v: string) => toggleFolder(v),
  togglePropValue: (...a: unknown[]) => togglePropValue(...a),
  clearFilters: () => clearFilters(),
}));
vi.mock("$lib/stores/vault", () => ({ selectNote: (...a: unknown[]) => selectNote(...a), currentNotePath, linkIndex }));

const Panel = (await import("./FilterPanel.svelte")).default;

function note(path: string, kind: string | null, topic: string | null, title?: string): LinkInfo {
  return {
    source_path: path,
    source_name: path.split("/").pop() ?? "",
    title: title ?? null,
    aliases: [],
    targets: [],
    tags: [],
    doc_kind: kind,
    topic,
    related: [],
    props: {},
  };
}

function haveNotes(...notes: LinkInfo[]) {
  linkIndex.set({ byPath: new Map(notes.map((n) => [n.source_path, n])) });
  const dk = new Map<string, number>();
  const tp = new Map<string, number>();
  for (const n of notes) {
    if (n.doc_kind) dk.set(n.doc_kind, (dk.get(n.doc_kind) ?? 0) + 1);
    if (n.topic) tp.set(n.topic, (tp.get(n.topic) ?? 0) + 1);
  }
  docKindCounts.set(dk);
  topicCounts.set(tp);
}

let target: HTMLElement;
let app: Record<string, unknown> | null = null;
const show = () => {
  app = mount(Panel, { target }) as Record<string, unknown>;
};
const texts = (sel: string) =>
  [...target.querySelectorAll(sel)].map((e) => e.textContent?.replace(/\s+/g, " ").trim());

beforeEach(() => {
  docKindCounts.set(new Map());
  topicCounts.set(new Map());
  selectedDocKinds.set(new Set());
  selectedTopics.set(new Set());
  selectedFolders.set(new Set());
  selectedProps.set(new Map());
  currentNotePath.set(null);
  linkIndex.set(null);
  for (const f of [toggleDocKind, toggleTopic, toggleFolder, togglePropValue, clearFilters, selectNote])
    f.mockClear();
  document.body.replaceChildren();
  target = document.createElement("div");
  document.body.appendChild(target);
});

afterEach(() => {
  if (app) void unmount(app);
  app = null;
});

describe("빈 상태", () => {
  it("인덱스가 없으면 안내만", () => {
    show();
    expect(target.querySelector(".empty")).not.toBeNull();
    expect(target.querySelector(".facet-area")).toBeNull();
  });
});

describe("칩", () => {
  beforeEach(() => haveNotes(note("/v/a.md", "plan", "ui"), note("/v/b.md", "adr", "cli")));

  it("종류와 주제를 개수와 함께 낸다", () => {
    show();
    expect(texts(".kind-chip")).toEqual(["plan 1", "adr 1"]);
    expect(texts(".topic-chip").sort()).toEqual(["cli 1", "ui 1"]);
  });

  it("누르면 토글한다", () => {
    show();
    target.querySelector<HTMLButtonElement>(".kind-chip")!.click();
    expect(toggleDocKind).toHaveBeenCalledWith("plan");
  });

  /** 🔴 눌린 칩에 표시가 붙어야 한다 — 이게 안 붙어서 두 릴리스를 그냥 나갔다. */
  it("고르면 active 가 붙는다", async () => {
    show();
    target.querySelector<HTMLButtonElement>(".kind-chip")!.click();
    await flushFrames(1);
    expect(
      target.querySelector(".kind-chip")?.classList.contains("active"),
      "눌렀는데 표시가 없다 — 고장과 구별이 안 된다",
    ).toBe(true);
  });
});

/**
 * 🔴 **클래스만으로는 부족하다.** 전례가 정확히 그 모양이었다 — `class:active` 는
 * 걸려 있는데 CSS 에 `.facet-chip.active` 규칙이 없어 화면이 안 바뀌었다.
 */
describe("CSS 훅이 실제로 있다", () => {
  // ⚠️ dom 프로젝트에서는 `import.meta.url` 이 파일 URL 이 아니다(vite 가 서빙한다).
  //    저장소 루트에서 읽는다 — vitest 는 루트에서 돈다.
  const SRC = readFileSync(path.join(process.cwd(), "src/lib/FilterPanel.svelte"), "utf-8");
  const STYLE = SRC.slice(SRC.indexOf("<style>"));

  for (const sel of [".facet-chip.active", ".note-row.active"]) {
    it(`${sel} 규칙이 있다`, () => {
      expect(STYLE, `${sel} 이 마크업에만 있고 CSS 에 없다`).toContain(sel);
    });
  }
});

describe("고른 뒤", () => {
  beforeEach(() => {
    haveNotes(
      note("/v/zeta.md", "plan", "ui", "Zeta"),
      note("/v/alpha.md", "plan", "cli", "alpha"),
      note("/v/other.md", "adr", "ui"),
    );
    selectedDocKinds.set(new Set(["plan"]));
  });

  /** ⚠️ 여기서 재는 것은 **어느 노트가 나오나**지 순서가 아니다 — 순서는 따로 안 정했다. */
  it("맞는 노트만 낸다", () => {
    show();
    const names = texts(".note-row .name").sort((a, b) =>
      (a ?? "").toLowerCase().localeCompare((b ?? "").toLowerCase()),
    );
    expect(names).toEqual(["alpha", "Zeta"]);
  });

  it("몇 건인지 말한다", () => {
    show();
    expect(texts(".match-count")[0]).toContain("2");
  });

  it("누르면 그 노트를 연다", () => {
    show();
    target.querySelector<HTMLButtonElement>(".note-row")!.click();
    expect(selectNote).toHaveBeenCalledWith(expect.stringContaining(".md"), { via: "search" });
  });

  it("지금 보는 노트를 표시한다", () => {
    currentNotePath.set("/v/alpha.md");
    show();
    expect(target.querySelectorAll(".note-row.active")).toHaveLength(1);
  });

  it("지우기가 선택을 푼다", () => {
    show();
    target.querySelector<HTMLButtonElement>(".clear-btn")!.click();
    expect(clearFilters).toHaveBeenCalled();
    expect(get(selectedDocKinds).size).toBe(0);
  });

  /** ⚠️ 아무것도 안 맞으면 **말한다.** 빈 목록은 "아직 안 골랐다"와 구별이 안 된다. */
  it("맞는 게 없으면 그렇다고 말한다", () => {
    selectedDocKinds.set(new Set(["없는종류"]));
    show();
    expect(target.querySelector(".empty.small")).not.toBeNull();
  });
});

/**
 * 🔴 **아무것도 안 골랐으면 결과를 안 보여준다.** `applyFilters` 의 계약이고,
 * 이걸 어기면 패널을 여는 것만으로 vault 전체가 쏟아진다.
 */
describe("고르기 전", () => {
  it("결과 목록도 액션 바도 없다", () => {
    haveNotes(note("/v/a.md", "plan", "ui"));
    show();
    expect(target.querySelector(".note-list")).toBeNull();
    expect(target.querySelector(".action-bar")).toBeNull();
  });
});
