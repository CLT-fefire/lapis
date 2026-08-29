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
const jumpToWikilink = vi.fn(async () => true);
const openUrl = vi.fn(async () => {});

vi.mock("$lib/tauri/notes", () => ({ readNote: (p: string) => readNote(p) }));
vi.mock("$lib/stores/vault", async () => {
  const { writable } = await import("svelte/store");
  return {
    selectNote: (...a: unknown[]) => selectNote(...a),
    jumpToWikilink: (...a: unknown[]) => jumpToWikilink(...(a as [])),
    currentNotePath: writable<string | null>(null),
    linkIndex: writable(null),
  };
});
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (...a: unknown[]) => openUrl(...(a as [])) }));
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
  jumpToWikilink.mockClear();
  openUrl.mockClear();
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
 * 🔴 **여기 있던 테스트 둘을 지웠다 — 그것들이 버그를 못 박고 있었다.**
 *
 * 두 테스트는 `<a class="wikilink" data-target-path="…">` 를 **손으로 만들어** 붙이고
 * 눌렀다. 즉 **렌더러가 실제로 내는 DOM 이 아니라, 망가진 컴포넌트가 기대하던 DOM** 을
 * 지어 놓고 잰 것이다. 그래서 기능이 통째로 죽은 채로 둘 다 초록이었다.
 *
 * ⚠️ 이 저장소가 같은 모양으로 반복해서 당한다: 5차 때 `scopeOptions` 의 단위 테스트가
 * **vault 상대경로**를 먹여서 함수는 통과하고 기능만 비어 있었다. 호출부는 절대경로를
 * 넘기고 있었다.
 *
 * 교훈: **입력을 지어내지 말고 파이프라인이 내는 것을 쓴다.** 아래 「링크를 누르면」은
 * 마크다운을 넣어 `parseNote` 가 낸 결과를 누른다.
 *
 * (둘째 테스트는 그 위에 공허하기까지 했다 — `.wikilink` 에 `data-target` 이 없는 상태는
 * 플러그인이 만들지 않는다. 일어날 수 없는 상황을 재고 있었다.)
 */

/**
 * 🔴 **눌리나.** 이 절이 이 파일에서 가장 값을 했다 — 셋 다 죽어 있었다.
 *
 * 옆칸은 본문과 **같은 부품**으로 그리니 결과 HTML 도 같다. 그런데 클릭 처리만 따로
 * 적혀 있었고 그 사본이 틀렸다:
 *
 * | 옆칸이 찾던 것 | 실제로 나오는 것 |
 * |---|---|
 * | `a.wikilink` | `span.wikilink` (플러그인 주석: "a 태그의 default navigation 위험 회피") |
 * | `data-target-path` | `data-target` — 앞 이름은 **저장소 어디서도 안 만든다** |
 *
 * 게다가 이름은 경로가 아니다. 푸는 것은 `jumpToWikilink` 다(같은 이름의 노트가 둘일 때
 * 지금 보는 노트를 맥락으로 쓴다). 그래서 눌러도 아무 일도 안 났고 **에러도 안 났다.**
 */
describe("링크를 누르면", () => {
  const click = (el: Element) => {
    const e = new MouseEvent("click", { bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e;
  };

  it("위키링크는 이름을 풀어서 간다", async () => {
    readNote.mockResolvedValue("[[대상 노트]] 를 보라");
    show("/v/a.md");
    await flush();
    const el = target.querySelector(".wikilink");
    expect(el, "위키링크가 안 그려졌다").toBeTruthy();
    click(el!);
    await flush();
    expect(jumpToWikilink).toHaveBeenCalledWith("대상 노트", "compare");
  });

  /** ⚠️ 바깥 URL 은 시스템 브라우저로. 웹뷰가 그리로 가 버리면 앱이 사라진다. */
  it("바깥 링크는 시스템 브라우저로 보내고 기본 동작을 막는다", async () => {
    readNote.mockResolvedValue("[바깥](https://example.com)");
    show("/v/a.md");
    await flush();
    const a = target.querySelector("a[href^='https']");
    expect(a, "링크가 안 그려졌다").toBeTruthy();
    const e = click(a!);
    await flush();
    expect(openUrl).toHaveBeenCalledWith("https://example.com");
    expect(e.defaultPrevented, "기본 동작을 안 막았다").toBe(true);
  });

  /** 마크다운 링크 `[글](b.md)` 도 노트다 — 확장자를 떼고 위키링크와 같은 판정을 쓴다. */
  it("안쪽 .md 링크도 노트로 간다", async () => {
    readNote.mockResolvedValue("[비](./sub/b.md)");
    show("/v/a.md");
    await flush();
    const a = target.querySelector("a[href$='b.md']");
    expect(a, "링크가 안 그려졌다").toBeTruthy();
    const e = click(a!);
    await flush();
    expect(jumpToWikilink).toHaveBeenCalledWith("b", "compare");
    expect(e.defaultPrevented, "SPA 라우팅을 안 막았다").toBe(true);
  });

  it("아무 데나 누르면 아무 일도 안 한다", async () => {
    readNote.mockResolvedValue("그냥 글");
    show("/v/a.md");
    await flush();
    click(target.querySelector("article.rendered")!);
    await flush();
    expect(jumpToWikilink).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });
});
