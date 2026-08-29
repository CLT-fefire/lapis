import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount } from "svelte";

/**
 * 나란히 보기 옆칸 — **동작을** 잰다.
 *
 * ## 🔴 왜 이 파일이 필요했나
 *
 * 커버리지 지도를 다시 그렸더니 `ComparePane.svelte` 가 "이름만" 칸에 있었다 —
 * a11y 가드와 CSS 훅 가드가 파일 **이름**을 알 뿐, 아무도 이 컴포넌트를 **띄워 보지**
 * 않았다. 소스를 읽는 가드가 많은 저장소라 "테스트가 닿았다"가 "동작을 잰다"를 뜻하지
 * 않는다는 걸 지도가 감추고 있었다.
 */

const readNote = vi.fn<(p: string) => Promise<string>>();
const selectNote = vi.fn();

vi.mock("$lib/tauri/notes", () => ({ readNote: (p: string) => readNote(p) }));
vi.mock("$lib/stores/vault", async () => {
  const { writable } = await import("svelte/store");
  return {
    selectNote: (...a: unknown[]) => selectNote(...a),
    currentNotePath: writable<string | null>(null),
    linkIndex: writable(null),
  };
});
// mermaid 는 동적 import 로 브라우저 모듈을 끌어온다 — 여기서 볼 것이 아니다.
vi.mock("$lib/mermaid-runtime", () => ({ renderMermaidIn: () => {} }));

const ComparePane = (await import("./ComparePane.svelte")).default;
// ⚠️ 프롭을 **바꿔 가며** 보려면 룬이 필요하고, 룬은 `.svelte` 안에서만 도다.
const Host = (await import("./testHarness/ComparePaneHost.svelte")).default;

/** 마이크로태스크 + 이펙트가 도는 틈. */
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

let target: HTMLElement;
let app: Record<string, unknown> | null = null;

const show = (path: string) => {
  app = mount(ComparePane, { target, props: { path } }) as Record<string, unknown>;
};

beforeEach(() => {
  readNote.mockReset();
  selectNote.mockReset();
  document.body.replaceChildren();
  target = document.createElement("div");
  document.body.appendChild(target);
});

afterEach(() => {
  if (app) void unmount(app);
  app = null;
});

describe("본문을 그린다", () => {
  it("읽어서 마크다운으로 그린다", async () => {
    readNote.mockResolvedValue("# 제목\n\n본문이다.");
    show("/v/a.md");
    await flush();
    expect(target.querySelector("article.rendered")?.innerHTML).toContain("제목");
  });

  /** ⚠️ 실패를 빈 칸으로 두지 않는다 — 빈 칸은 "빈 노트"와 구별이 안 된다. */
  it("못 읽으면 이유를 보여준다", async () => {
    readNote.mockRejectedValue(new Error("permission denied"));
    show("/v/a.md");
    await flush();
    expect(target.textContent).toContain("permission denied");
    expect(target.querySelector("article.rendered")).toBeNull();
  });
});

/**
 * 🔴 **경로가 바뀌는 동안 옛 노트를 보여주면 안 된다.**
 *
 * 읽기는 비동기다. `path` 가 B 로 바뀐 순간 머리글은 B 를 말하는데, 본문은 A 의 것이
 * 그대로 남아 있다가 응답이 와야 바뀐다. 그 사이가 **틀린 화면**이다 — 머리글과 본문이
 * 서로 다른 노트를 가리키는데 아무 신호도 없다.
 *
 * ⚠️ 잠깐이라 안 보인다고 넘기면 안 된다. 큰 노트나 느린 디스크에서는 충분히 길고,
 * 무엇보다 **틀린 것이 틀려 보이지 않는다.**
 *
 * ⚠️ 컴포넌트를 **다시 띄워** 검사하지 않는다. 그러면 새 인스턴스라 애초에 옛 본문이
 * 없어서 무엇을 잰 게 아니다. 같은 인스턴스의 `path` 를 바꿔야 이 결함이 드러난다.
 */
describe("경로가 바뀔 때", () => {
  it("옛 본문을 안 보여준다", async () => {
    let resolveB: (v: string) => void = () => {};
    readNote.mockImplementation((p: string) =>
      p === "/v/a.md"
        ? Promise.resolve("에이의 본문")
        : new Promise<string>((res) => {
            resolveB = res;
          }),
    );

    const host = mount(Host, { target, props: {} }) as { setPath(p: string): void };
    app = host as unknown as Record<string, unknown>;
    host.setPath("/v/a.md");
    await flush();
    expect(target.textContent).toContain("에이의 본문");

    host.setPath("/v/b.md");
    await flush();
    expect(target.textContent, "머리글은 B 인데 본문이 아직 A 다").not.toContain(
      "에이의 본문",
    );

    resolveB("비의 본문");
    await flush();
    expect(target.textContent).toContain("비의 본문");
  });

  /**
   * ⚠️ **늦게 온 응답이 새 것을 덮으면 안 된다.** A 를 읽는 중에 B 로 갔는데 A 의 응답이
   * 뒤늦게 오면, 화면에는 B 가 떠 있어야 한다.
   */
  it("늦게 온 응답을 버린다", async () => {
    let resolveA: (v: string) => void = () => {};
    readNote.mockImplementation((p: string) =>
      p === "/v/a.md"
        ? new Promise<string>((res) => {
            resolveA = res;
          })
        : Promise.resolve("비의 본문"),
    );

    const host = mount(Host, { target, props: {} }) as { setPath(p: string): void };
    app = host as unknown as Record<string, unknown>;
    host.setPath("/v/a.md");
    await flush();
    host.setPath("/v/b.md");
    await flush();
    expect(target.textContent).toContain("비의 본문");

    resolveA("에이의 본문");
    await flush();
    expect(target.textContent, "늦게 온 A 가 B 를 덮었다").not.toContain("에이의 본문");
  });
});

/**
 * ⚠️ 옆칸의 링크는 **본문**을 움직인다. 옆칸이 스스로 이동하면 "어느 쪽이 지금 보는
 * 것인가"가 흐려진다.
 */
describe("링크", () => {
  it("위키링크가 본문을 움직인다", async () => {
    readNote.mockResolvedValue("본문");
    show("/v/a.md");
    await flush();

    const article = target.querySelector("article.rendered")!;
    const a = document.createElement("a");
    a.className = "wikilink";
    a.setAttribute("data-target-path", "/v/target.md");
    a.textContent = "가기";
    article.replaceChildren(a);
    a.click();

    expect(selectNote).toHaveBeenCalledWith("/v/target.md", { via: "compare" });
  });

  it("대상 없는 링크는 아무 일도 안 한다", async () => {
    readNote.mockResolvedValue("본문");
    show("/v/a.md");
    await flush();

    const article = target.querySelector("article.rendered")!;
    const a = document.createElement("a");
    a.className = "wikilink";
    a.textContent = "대상 없음";
    article.replaceChildren(a);
    a.click();

    expect(selectNote).not.toHaveBeenCalled();
  });
});
