import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount } from "svelte";
import { writable } from "svelte/store";

/**
 * 즐겨찾기·최근 패널의 **화면**.
 *
 * ## 🔴 왜 이 파일이 필요했나
 *
 * 읽던 자리 표식(`readingMark.ts`)은 순수 함수로 덮여 있었지만, **그리는 쪽**은 아무도
 * 안 봤다. 커버리지 지도에서 `FavoritesPanel.svelte` 가 "이름만" 칸에 있었다.
 *
 * 이 저장소가 같은 모양으로 두 번 당했다 — 필터 칩은 `class:active` 가 걸려 있는데
 * **CSS 규칙만 없어** 두 릴리스를 그냥 나갔고, 실패 배너는 스토어가 초록인데 그리는
 * 쪽이 안 덮여 있었다.
 */

const pinned = writable<string[]>([]);
const recent = writable<string[]>([]);
const positions = writable(new Map<string, { scroll: number; line?: number }>());
const currentNotePath = writable<string | null>(null);
const linkIndex = writable<{ byPath: Map<string, unknown> } | null>(null);

vi.mock("$lib/stores/pins", () => ({
  pinnedNotePaths: pinned,
  removePin: () => {},
}));
vi.mock("$lib/stores/recent", () => ({ recentNotePaths: recent }));
vi.mock("$lib/stores/readingPos", () => ({
  positions,
  posFor: (p: string) => {
    let v: { scroll: number; line?: number } | undefined;
    positions.subscribe((m) => (v = m.get(p)))();
    return v ?? null;
  },
}));
vi.mock("$lib/stores/vault", () => ({
  currentNotePath,
  linkIndex,
  selectNote: () => {},
}));

const Panel = (await import("./FavoritesPanel.svelte")).default;

let target: HTMLElement;
let app: Record<string, unknown> | null = null;

/** vault 에 실제로 있는 경로만 그린다 — 패널이 `linkIndex.byPath` 로 거른다. */
function haveNotes(...paths: string[]) {
  linkIndex.set({ byPath: new Map(paths.map((p) => [p, {}])) });
}

const show = () => {
  app = mount(Panel, { target }) as Record<string, unknown>;
};

beforeEach(() => {
  pinned.set([]);
  recent.set([]);
  positions.set(new Map());
  currentNotePath.set(null);
  linkIndex.set(null);
  document.body.replaceChildren();
  target = document.createElement("div");
  document.body.appendChild(target);
});

afterEach(() => {
  if (app) void unmount(app);
  app = null;
});

const marks = () =>
  [...target.querySelectorAll(".mark")].map((e) => ({
    text: e.textContent?.trim(),
    line: e.classList.contains("mark--line"),
  }));

describe("읽던 자리 표식", () => {
  it("자리가 없으면 표식이 없다", () => {
    haveNotes("/v/a.md");
    recent.set(["/v/a.md"]);
    show();
    expect(marks()).toEqual([]);
  });

  it("미리보기 자리는 점이다", () => {
    haveNotes("/v/a.md");
    recent.set(["/v/a.md"]);
    positions.set(new Map([["/v/a.md", { scroll: 1200 }]]));
    show();
    expect(marks()).toEqual([{ text: "•", line: false }]);
  });

  it("편집기 자리는 줄 번호다", () => {
    haveNotes("/v/a.md");
    recent.set(["/v/a.md"]);
    positions.set(new Map([["/v/a.md", { scroll: 0, line: 42 }]]));
    show();
    expect(marks()).toEqual([{ text: "42", line: true }]);
  });

  /**
   * 🔴 **핀에는 안 붙는다.** 핀은 "보관한 것"이지 "읽던 것"이 아니다.
   *
   * ⚠️ 이 검사가 없으면 마크업을 잘못된 절에 붙여도 초록이다 — 두 목록이 같은 CSS 클래스를
   * 쓰기 때문이다.
   */
  it("핀에는 안 붙는다", () => {
    haveNotes("/v/a.md");
    pinned.set(["/v/a.md"]);
    positions.set(new Map([["/v/a.md", { scroll: 1200 }]]));
    show();
    expect(marks(), "핀 항목에 읽던 자리가 붙었다").toEqual([]);
  });

  /** 여럿이면 각자 자기 표식을 단다 — 한 항목의 자리가 옆으로 새면 안 된다. */
  it("항목마다 제 것을 단다", () => {
    haveNotes("/v/a.md", "/v/b.md", "/v/c.md");
    recent.set(["/v/a.md", "/v/b.md", "/v/c.md"]);
    positions.set(
      new Map([
        ["/v/a.md", { scroll: 100 }],
        ["/v/c.md", { scroll: 0, line: 7 }],
      ]),
    );
    show();
    expect(marks()).toEqual([
      { text: "•", line: false },
      { text: "7", line: true },
    ]);
  });
});

/**
 * ⚠️ vault 에 없는 경로는 안 그린다 — 핀·최근은 **전역**이라 다른 vault 의 것이 섞인다.
 */
describe("없는 노트는 안 그린다", () => {
  it("인덱스에 없으면 뺀다", () => {
    haveNotes("/v/a.md");
    recent.set(["/v/a.md", "/other/b.md"]);
    show();
    const labels = [...target.querySelectorAll(".label")].map((e) => e.textContent?.trim());
    expect(labels).toEqual(["a"]);
  });

  it("인덱스가 아직 없으면 아무것도 안 그린다", () => {
    recent.set(["/v/a.md"]);
    show();
    expect(target.querySelectorAll(".label").length).toBe(0);
  });
});
