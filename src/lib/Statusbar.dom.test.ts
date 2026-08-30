import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount } from "svelte";
import { writable } from "svelte/store";

/**
 * 상태바 — 셸의 마지막 줄. **그리는 쪽.**
 *
 * ## 🔴 왜 필요했나
 *
 * 이 한 줄이 답하는 질문이 다섯이다: 감시가 도나 · 노트가 몇 개인가 · 지금 뭘 보나 ·
 * 마지막 커밋이 언제인가 · **뭔가 깨졌나.** 스토어는 전부 덮여 있었지만 그 값이 화면에
 * 닿는지는 아무도 안 봤다.
 *
 * 🔴 특히 오류 칸은 **릴리스에 devtools 가 없어서** 존재한다. 그게 안 뜨면 사용자는
 * 뭔가 깨졌다는 사실 자체를 모른다 — 안 뜨는 것이 곧 결함이다.
 */

const vaultPath = writable<string | null>(null);
const linkIndex = writable<{ byPath: Map<string, unknown> } | null>(null);
const currentNotePath = writable<string | null>(null);
const indexBuilding = writable(false);
const indexRefreshing = writable(false);
const treeLoading = writable(false);
const watcherStatus = writable<string>("idle");
const lastCommit = writable<{ at: number } | null>(null);
/** ⚠️ 스토어가 아니라 **함수**다. 스토어로 목킹하면 렌더가 통째로 터진다. */
let fakeBackend = false;
const sessionErrors = writable(0);
const sessionWarns = writable(0);

vi.mock("$lib/stores/vault", () => ({
  vaultPath,
  linkIndex,
  currentNotePath,
  indexBuilding,
  indexRefreshing,
  treeLoading,
}));
vi.mock("$lib/stores/watcher", () => ({ watcherStatus }));
vi.mock("$lib/stores/git", () => ({
  lastCommit,
  formatCommitDate: (s: number) => `t${s}`,
}));
vi.mock("$lib/tauri/invoke", () => ({ usingFakeBackend: () => fakeBackend }));
vi.mock("$lib/stores/usage", () => ({ sessionErrors, sessionWarns }));

const Statusbar = (await import("./Statusbar.svelte")).default;

let target: HTMLElement;
let app: Record<string, unknown> | null = null;

const show = (props: Record<string, unknown> = {}) => {
  app = mount(Statusbar, { target, props }) as Record<string, unknown>;
};
const text = (sel: string) => target.querySelector(sel)?.textContent?.replace(/\s+/g, " ").trim();

beforeEach(() => {
  vaultPath.set("/v");
  linkIndex.set(null);
  currentNotePath.set(null);
  indexBuilding.set(false);
  indexRefreshing.set(false);
  treeLoading.set(false);
  watcherStatus.set("idle");
  lastCommit.set(null);
  fakeBackend = false;
  sessionErrors.set(0);
  sessionWarns.set(0);
  document.body.replaceChildren();
  target = document.createElement("div");
  document.body.appendChild(target);
});

afterEach(() => {
  if (app) void unmount(app);
  app = null;
});

/**
 * 🔴 **상태 하나만 보여준다. 순서가 규칙이다.**
 *
 * 바쁜 상태(색인·갱신·트리 읽기)가 감시 상태보다 앞이다 — 색인 중인데 "감시 중"이라고
 * 쓰면 사용자는 앱이 놀고 있다고 읽는다. 순서가 뒤집히면 **바쁜 티가 안 난다.**
 */
describe("상태 한 줄", () => {
  const tone = () => target.querySelector(".dot")?.className ?? "";

  /** ⚠️ idle 은 **클래스가 없다** — 색이 붙는 것은 ok · busy · error 셋뿐이다. */
  it("아무것도 안 하면 색이 안 붙는다", () => {
    show();
    for (const c of ["ok", "busy", "error"]) expect(tone()).not.toContain(c);
    expect(target.querySelector(".status-text")?.textContent?.trim()).toBeTruthy();
  });

  it("감시 중이면 ok", () => {
    watcherStatus.set("watching");
    show();
    expect(tone()).toContain("ok");
  });

  it("감시가 깨지면 error", () => {
    watcherStatus.set("error");
    show();
    expect(tone()).toContain("error");
  });

  it("색인 중이면 감시 상태를 밀어낸다", () => {
    watcherStatus.set("watching");
    indexBuilding.set(true);
    show();
    expect(tone(), "감시 중이라고 써서 노는 것처럼 보인다").toContain("busy");
  });

  it("트리를 읽는 중도 바쁨이다", () => {
    watcherStatus.set("watching");
    treeLoading.set(true);
    show();
    expect(tone()).toContain("busy");
  });
});

describe("노트 수", () => {
  /**
   * ⚠️ 0 이면 **칸 자체를 안 그린다.** "0" 을 띄우면 인덱스가 아직 안 만들어진 것과
   * 정말로 노트가 없는 것이 화면에서 같아 보인다.
   */
  it("인덱스가 없으면 칸이 없다", () => {
    show();
    expect(target.querySelector(".count")).toBeNull();
  });

  it("인덱스 크기를 낸다", () => {
    linkIndex.set({ byPath: new Map([["a", 1], ["b", 2]]) });
    show();
    expect(text(".count")).toBe("2");
  });

  /** ⚠️ 큰 vault 에서 자릿수 구분이 없으면 19225 가 1922 5 로 잘못 읽힌다. */
  it("천 단위를 끊어 쓴다", () => {
    linkIndex.set({ byPath: new Map(Array.from({ length: 1234 }, (_, i) => [String(i), i])) });
    show();
    expect(text(".count")).toContain(",");
  });
});

/**
 * 🔴 **릴리스에는 devtools 가 없다.** 로그에는 쌓이지만 파일을 열기 전에는 깨졌다는
 * 사실 자체를 모른다. 숫자 한 칸이 그 자리에서 알려 준다.
 *
 * ⚠️ **끼어들지는 않는다** — 세기만 한다. 관찰이 대상을 바꾸면 안 된다.
 */
describe("오류·경고 칸", () => {
  it("아무 일도 없으면 안 뜬다", () => {
    show();
    expect(target.querySelector(".errs")).toBeNull();
  });

  it("경고만 있어도 뜬다", () => {
    sessionWarns.set(3);
    show();
    expect(text(".errs")).toContain("3");
    expect(target.querySelector(".errs")?.classList.contains("has-error")).toBe(false);
  });

  it("오류가 있으면 표식이 달라진다", () => {
    sessionErrors.set(2);
    show();
    expect(text(".errs")).toContain("⚠");
    expect(target.querySelector(".errs")?.classList.contains("has-error")).toBe(true);
  });

  /** 둘을 **합쳐서** 센다 — 두 숫자를 나란히 두면 한 칸에 안 들어간다. */
  it("오류와 경고를 합쳐 센다", () => {
    sessionErrors.set(2);
    sessionWarns.set(3);
    show();
    expect(text(".errs")).toContain("5");
  });
});

describe("경로", () => {
  it("노트가 없으면 안 뜬다", () => {
    show();
    expect(target.querySelector(".path")).toBeNull();
  });

  /** ⚠️ 표시는 마지막 두 조각. **복사되는 것은 절대 경로**이고 그건 호출부가 한다. */
  it("마지막 두 조각만 보여준다", () => {
    currentNotePath.set("/v/deep/sub/note.md");
    show();
    expect(text(".path")).toBe("sub/note.md");
  });

  it("누르면 호출부에 맡긴다", () => {
    const onCopyPath = vi.fn();
    currentNotePath.set("/v/a.md");
    show({ onCopyPath });
    target.querySelector<HTMLButtonElement>(".path")!.click();
    expect(onCopyPath).toHaveBeenCalledTimes(1);
  });

  it("복사한 뒤에는 표시가 바뀐다", () => {
    currentNotePath.set("/v/a.md");
    show({ pathCopied: true });
    expect(text(".path")).toContain("✓");
  });
});

describe("dev 가짜 백엔드", () => {
  /**
   * 🔴 **실제 vault 가 아니라는 표시.** 없으면 픽스처를 보고 실제 노트라고 착각한다 —
   * 그 상태에서 "고쳤다"고 판단하면 아무것도 안 고친 것이다.
   */
  it("가짜 백엔드가 아니면 배지가 없다", () => {
    show();
    expect(target.querySelector(".fixture")).toBeNull();
  });

  it("가짜 백엔드면 배지가 뜬다", () => {
    fakeBackend = true;
    show();
    expect(target.querySelector(".fixture")).not.toBeNull();
  });
});

describe("문서 통계", () => {
  it("주면 보여주고 없으면 안 그린다", () => {
    show({ docStats: "10단어 · 38자" });
    expect(text(".stats")).toBe("10단어 · 38자");
  });

  it("null 이면 칸 자체가 없다", () => {
    show({ docStats: null });
    expect(target.querySelector(".stats")).toBeNull();
  });
});
