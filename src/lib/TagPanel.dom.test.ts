import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount } from "svelte";
import { writable } from "svelte/store";
import { buildTagIndex } from "./tagIndex";
import type { LinkInfo } from "./tauri/notes";
import { flushFrames } from "./testHarness/animateStub";

/**
 * 태그 패널 — **그리는 쪽.**
 *
 * ## 🔴 왜 필요했나
 *
 * `tagIndex.ts`(트리를 만드는 쪽)는 덮여 있었는데 **그걸 그리는 쪽**은 아무도 안 봤다.
 * 이 저장소가 같은 모양으로 네 번 당했다 — 실패 배너 · 필터 칩 · 옆칸 링크 · 동의 모달.
 * 스토어가 초록이어도 화면이 그걸 안 쓰면 기능은 없는 것이다.
 *
 * ⚠️ 픽스처를 **손으로 짓지 않는다.** 진짜 `buildTagIndex` 에 노트를 먹여서 만든다 —
 * 손으로 지으면 "망가진 컴포넌트가 기대하던 모양"을 재게 된다(옆칸 링크에서 실제로 그랬다).
 */

const tagIndex = writable<ReturnType<typeof buildTagIndex> | null>(null);
const selectedTag = writable<string | null>(null);
const selectedTagKind = writable<"leaf" | "prefix">("leaf");
const expandedPrefixes = writable<Set<string>>(new Set());
const currentNotePath = writable<string | null>(null);
const linkIndex = writable<{ byPath: Map<string, LinkInfo> } | null>(null);

const selectTag = vi.fn((k: string | null, kind: "leaf" | "prefix" = "leaf") => {
  selectedTag.set(k);
  selectedTagKind.set(kind);
});
const togglePrefix = vi.fn((p: string) =>
  expandedPrefixes.update((s) => {
    const n = new Set(s);
    if (n.has(p)) n.delete(p);
    else n.add(p);
    return n;
  }),
);
const selectNote = vi.fn();

vi.mock("$lib/stores/tags", () => ({
  tagIndex,
  selectedTag,
  selectedTagKind,
  expandedPrefixes,
  selectTag: (...a: unknown[]) => selectTag(...(a as [string | null])),
  togglePrefix: (p: string) => togglePrefix(p),
}));
vi.mock("$lib/stores/vault", () => ({
  selectNote: (...a: unknown[]) => selectNote(...a),
  currentNotePath,
  linkIndex,
}));

const Panel = (await import("./TagPanel.svelte")).default;

function note(path: string, tags: string[], title: string | null = null): LinkInfo {
  return {
    source_path: path,
    source_name: path.split("/").pop() ?? "",
    title,
    aliases: [],
    targets: [],
    tags,
    doc_kind: null,
    topic: null,
    related: [],
    props: {},
  };
}

/** 진짜 인덱스 빌더를 통과시킨다. */
function haveNotes(...notes: LinkInfo[]) {
  tagIndex.set(buildTagIndex(notes));
  linkIndex.set({ byPath: new Map(notes.map((n) => [n.source_path, n])) });
}

let target: HTMLElement;
let app: Record<string, unknown> | null = null;
const show = () => {
  app = mount(Panel, { target }) as Record<string, unknown>;
};

const texts = (sel: string) =>
  [...target.querySelectorAll(sel)].map((e) => e.textContent?.replace(/\s+/g, " ").trim());

beforeEach(() => {
  tagIndex.set(null);
  selectedTag.set(null);
  selectedTagKind.set("leaf");
  expandedPrefixes.set(new Set());
  currentNotePath.set(null);
  linkIndex.set(null);
  selectTag.mockClear();
  togglePrefix.mockClear();
  selectNote.mockClear();
  document.body.replaceChildren();
  target = document.createElement("div");
  document.body.appendChild(target);
});

afterEach(() => {
  if (app) void unmount(app);
  app = null;
});

describe("빈 상태", () => {
  it("인덱스가 없으면 안내를 보여준다", () => {
    show();
    expect(target.querySelector(".empty")).not.toBeNull();
    expect(target.querySelector(".tag-tree")).toBeNull();
  });

  /** ⚠️ 태그가 하나도 없는 vault 도 빈 상태다 — 빈 트리를 그리면 고장처럼 보인다. */
  it("태그가 하나도 없어도 빈 상태다", () => {
    haveNotes(note("/v/a.md", []));
    show();
    expect(target.querySelector(".empty")).not.toBeNull();
  });
});

describe("트리", () => {
  it("루트 접두사를 개수와 함께 낸다", () => {
    haveNotes(note("/v/a.md", ["subject/ui"]), note("/v/b.md", ["subject/cli"]));
    show();
    expect(texts(".prefix-name")).toEqual(["subject/ 2"]);
  });

  /** ⚠️ 기본은 접힘이다. 다 펼쳐 두면 태그가 많은 vault 에서 목록이 화면을 덮는다. */
  it("기본은 접혀 있다", () => {
    haveNotes(note("/v/a.md", ["subject/ui"]));
    show();
    expect(target.querySelector(".child-list")).toBeNull();
  });

  it("펼치면 자식이 나온다", async () => {
    haveNotes(note("/v/a.md", ["subject/ui"]), note("/v/b.md", ["subject/cli"]));
    show();
    target.querySelector<HTMLButtonElement>(".prefix-toggle")!.click();
    // ⚠️ 스토어를 바꾼 뒤 다시 그려질 틈을 준다. 안 기다리면 **옛 화면**을 재고
    //    "자식이 안 나온다"는 틀린 결론이 나온다.
    await flushFrames(1);
    expect(togglePrefix).toHaveBeenCalledWith("subject");
    expect(texts(".child-chip").length).toBe(2);
  });
});

/**
 * 🔴 **정확 태그이면서 동시에 상위 접두사인 경우.**
 *
 * v3.1.2 에서 고친 결함이다. 예전 판정은 `prefixCounts>0 && !byTag.has()` 였는데,
 * `a/b` 가 그 자체로 붙어 있으면서 `a/b/c` 도 있으면 false 가 되어 **leaf 로** 골랐다.
 * 그러면 더 깊은 노트는 칩도 없고 접두사 선택도 안 돼서 **트리에서 닿을 수 없었다.**
 *
 * 지금 판정은 "자식이 있으면 접두사"다. 그 자체로 태그된 노트는 `byPrefix` 가 자기
 * 자신을 포함하므로 빠지지 않는다(MCP 와 같은 규칙).
 */
describe("🔴 태그가 접두사이기도 할 때", () => {
  const setup = () =>
    haveNotes(
      note("/v/self.md", ["a/b"]), // `a/b` 그 자체
      note("/v/deep.md", ["a/b/c"]), // 그 아래
    );

  it("자식이 있으면 접두사로 고른다", async () => {
    setup();
    show();
    target.querySelector<HTMLButtonElement>(".prefix-toggle")!.click();
    await flushFrames(1);
    const chip = target.querySelector<HTMLButtonElement>(".child-chip")!;
    expect(chip.classList.contains("sub-prefix"), "leaf 로 골랐다 — 깊은 노트에 못 닿는다").toBe(
      true,
    );
    chip.click();
    expect(selectTag).toHaveBeenCalledWith("a/b", "prefix");
  });

  /** 🔴 접두사로 골라도 **그 자체로 태그된 노트가 빠지면 안 된다.** */
  it("접두사로 고르면 자기 자신과 하위가 다 나온다", () => {
    setup();
    selectedTag.set("a/b");
    selectedTagKind.set("prefix");
    show();
    expect(texts(".note-row .name").sort()).toEqual(["deep.md", "self.md"]);
  });
});

describe("고른 뒤", () => {
  beforeEach(() => {
    haveNotes(
      note("/v/zebra.md", ["subject/ui"], "Zebra"),
      note("/v/apple.md", ["subject/ui"], "apple"),
      note("/v/other.md", ["subject/cli"]),
    );
  });

  it("leaf 는 `#` 을 붙이고 개수를 낸다", () => {
    selectedTag.set("subject/ui");
    show();
    expect(texts(".filter-chip")[0]).toContain("#subject/ui");
    expect(texts(".filter-chip")[0]).toContain("2");
  });

  it("접두사는 `/` 로 끝난다", () => {
    selectedTag.set("subject");
    selectedTagKind.set("prefix");
    show();
    expect(texts(".filter-chip")[0]).toContain("subject/");
    expect(target.querySelector(".filter-chip")?.classList.contains("prefix")).toBe(true);
  });

  /** ⚠️ 대소문자를 안 가리고 정렬한다 — 안 그러면 대문자로 시작하는 것이 전부 위로 몰린다. */
  it("노트를 이름순으로 낸다 (대소문자 무시)", () => {
    selectedTag.set("subject/ui");
    show();
    expect(texts(".note-row .name")).toEqual(["apple", "Zebra"]);
  });

  it("누르면 그 노트를 연다", () => {
    selectedTag.set("subject/ui");
    show();
    target.querySelector<HTMLButtonElement>(".note-row")!.click();
    expect(selectNote).toHaveBeenCalledWith("/v/apple.md", { via: "search" });
  });

  it("지금 보고 있는 노트를 표시한다", () => {
    selectedTag.set("subject/ui");
    currentNotePath.set("/v/zebra.md");
    show();
    const active = [...target.querySelectorAll(".note-row.active")].map(
      (e) => e.querySelector(".name")?.textContent,
    );
    expect(active).toEqual(["Zebra"]);
  });

  it("칩의 ×로 선택을 푼다", () => {
    selectedTag.set("subject/ui");
    show();
    target.querySelector<HTMLButtonElement>(".chip-close")!.click();
    expect(selectTag).toHaveBeenCalledWith(null);
  });
});
