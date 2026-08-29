import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 그려진 본문 안의 클릭 — **본문 칸과 옆칸이 같이 쓰는 규칙.**
 *
 * ## 🔴 왜 이 파일이 생겼나
 *
 * 이 규칙은 원래 `+page.svelte` 안에 있었다. 컴포넌트 안에 있으니 아무도 못 불렀고,
 * 그래서 나란히 보기를 넣을 때 **옆칸에 다시 적었다.** 그 사본이 선택자도 속성도 틀려서
 * 옆칸의 링크가 통째로 죽었는데 **에러가 안 났다.**
 *
 * 꺼내 놓으니 잴 수 있다. 아래는 옆칸 테스트로는 못 닿는 것들이다 — mermaid 분기와
 * **순서 계약**.
 */

const jumpToWikilink = vi.fn(async () => true);
const openUrl = vi.fn(async () => {});
const exportMermaidHostToPng = vi.fn(async () => {});
const logError = vi.fn();

vi.mock("$lib/stores/vault", () => ({
  jumpToWikilink: (...a: unknown[]) => jumpToWikilink(...(a as [])),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (...a: unknown[]) => openUrl(...(a as [])) }));
vi.mock("$lib/mermaidExport", () => ({
  exportMermaidHostToPng: (...a: unknown[]) => exportMermaidHostToPng(...(a as [])),
}));
vi.mock("$lib/stores/usage", () => ({ logError: (...a: unknown[]) => logError(...(a as [])) }));

const { handleRenderedClick } = await import("./previewClick");

let root: HTMLElement;

/** 실제 클릭처럼 버블링·취소 가능한 이벤트를 태워 보낸다. */
async function clickOn(html: string, sel: string, notePath: string | null = "/v/a.md") {
  root.innerHTML = html;
  const el = root.querySelector(sel);
  if (!el) throw new Error(`선택자가 아무것도 못 찾았다: ${sel}`);
  const e = new MouseEvent("click", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "target", { value: el });
  await handleRenderedClick(e, notePath, "wikilink");
  return e;
}

beforeEach(() => {
  jumpToWikilink.mockClear().mockResolvedValue(true);
  openUrl.mockClear();
  exportMermaidHostToPng.mockClear();
  logError.mockClear();
  document.body.replaceChildren();
  root = document.createElement("div");
  document.body.appendChild(root);
});

describe("위키링크", () => {
  it("`data-target` 을 읽어 이름으로 푼다", async () => {
    await clickOn(`<span class="wikilink" data-target="어떤 노트">글</span>`, ".wikilink");
    expect(jumpToWikilink).toHaveBeenCalledWith("어떤 노트", "wikilink");
  });

  /** ⚠️ 안쪽 자식을 눌러도 잡혀야 한다 — 강조·코드가 링크 안에 들어온다. */
  it("링크 안쪽을 눌러도 잡힌다", async () => {
    await clickOn(`<span class="wikilink" data-target="가"><em id="k">글</em></span>`, "#k");
    expect(jumpToWikilink).toHaveBeenCalledWith("가", "wikilink");
  });

  it("`data-target` 이 없으면 아무 일도 안 하되 기본 동작은 막는다", async () => {
    const e = await clickOn(`<span class="wikilink">글</span>`, ".wikilink");
    expect(jumpToWikilink).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  /** 🔴 `via` 는 **호출부가 준다.** 여기서 추측하면 통계가 조용히 반쪽이 된다. */
  it("호출부가 준 via 를 그대로 싣는다", async () => {
    root.innerHTML = `<span class="wikilink" data-target="가">글</span>`;
    const el = root.querySelector(".wikilink")!;
    const e = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "target", { value: el });
    await handleRenderedClick(e, "/v/a.md", "compare");
    expect(jumpToWikilink).toHaveBeenCalledWith("가", "compare");
  });
});

describe("일반 링크", () => {
  it("바깥 URL 은 시스템 브라우저로", async () => {
    const e = await clickOn(`<a href="https://example.com/x">밖</a>`, "a");
    expect(openUrl).toHaveBeenCalledWith("https://example.com/x");
    expect(e.defaultPrevented).toBe(true);
  });

  it("mailto 도 바깥이다", async () => {
    await clickOn(`<a href="mailto:someone@example.com">메일</a>`, "a");
    expect(openUrl).toHaveBeenCalledWith("mailto:someone@example.com");
  });

  /** ⚠️ `openUrl` 이 실패해도 던지지 않는다 — 링크 하나 때문에 화면이 멈추면 안 된다. */
  it("바깥 URL 이 실패하면 남기고 넘어간다", async () => {
    openUrl.mockRejectedValueOnce(new Error("nope"));
    await expect(clickOn(`<a href="https://example.com">밖</a>`, "a")).resolves.toBeDefined();
    expect(logError).toHaveBeenCalled();
  });

  it("안쪽 .md 링크는 마지막 조각을 이름으로 쓴다", async () => {
    await clickOn(`<a href="./sub/dir/b.md">안</a>`, "a");
    expect(jumpToWikilink).toHaveBeenCalledWith("b", "wikilink");
  });

  it("루트 절대 경로도 같다", async () => {
    await clickOn(`<a href="/notes/c.MD">안</a>`, "a");
    expect(jumpToWikilink).toHaveBeenCalledWith("c", "wikilink");
  });

  /** 🔴 SPA 라우팅을 막는 것이 핵심이다 — 웹뷰가 떠나면 앱이 사라진다. */
  it("빈 href · # 는 막기만 하고 아무 데도 안 간다", async () => {
    for (const href of ["", "#"]) {
      jumpToWikilink.mockClear();
      const e = await clickOn(`<a href="${href}">x</a>`, "a");
      expect(e.defaultPrevented, `href="${href}" 를 안 막았다`).toBe(true);
      expect(jumpToWikilink).not.toHaveBeenCalled();
    }
  });

  it("링크가 아니면 손대지 않는다", async () => {
    const e = await clickOn(`<p>그냥 글</p>`, "p");
    expect(e.defaultPrevented).toBe(false);
    expect(jumpToWikilink).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe("mermaid 내보내기 버튼", () => {
  const HOST = `<div class="mermaid-host"><svg></svg><button class="mermaid-export-btn">내보내기</button></div>`;

  it("호스트를 넘기고 파일 이름은 노트에서 딴다", async () => {
    await clickOn(HOST, ".mermaid-export-btn", "/v/sub/그림 노트.md");
    expect(exportMermaidHostToPng).toHaveBeenCalledWith(
      root.querySelector(".mermaid-host"),
      "그림 노트",
    );
  });

  it("열린 노트가 없으면 diagram 으로", async () => {
    await clickOn(HOST, ".mermaid-export-btn", null);
    expect(exportMermaidHostToPng).toHaveBeenCalledWith(expect.anything(), "diagram");
  });

  /**
   * 🔴 **순서 계약.** mermaid 검사가 anchor 검사보다 **앞**이어야 한다.
   * `<button>` 은 `closest("a")` 에 안 걸려서, 뒤로 밀리면 `if (!anchor) return` 에
   * 걸려 **조용히 무시된다.** 원본 주석이 이걸 적어 뒀는데 주석은 실행되지 않는다.
   */
  it("링크 안에 있어도 버튼이 먼저다", async () => {
    await clickOn(`<a href="https://example.com">${HOST}</a>`, ".mermaid-export-btn");
    expect(exportMermaidHostToPng).toHaveBeenCalled();
    expect(openUrl, "바깥 링크로 새 버렸다").not.toHaveBeenCalled();
  });

  it("내보내기가 실패해도 던지지 않는다", async () => {
    exportMermaidHostToPng.mockRejectedValueOnce(new Error("canvas 없음"));
    await expect(clickOn(HOST, ".mermaid-export-btn")).resolves.toBeDefined();
    expect(logError).toHaveBeenCalled();
  });
});
