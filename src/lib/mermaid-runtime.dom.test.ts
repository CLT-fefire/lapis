/** 프리뷰 DOM 후처리 — 컴포넌트를 띄우지 않고 원소만 만들어 태운다. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderMermaidIn, resetMermaidHosts } from "./mermaid-runtime";

const hosts = (html: string) => {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
};

describe("resetMermaidHosts", () => {
  it("data-rendered를 떼서 재렌더 대상으로 되돌린다", () => {
    const el = hosts(`
      <div class="mermaid-host" data-rendered="1">a</div>
      <div class="mermaid-host">b</div>
      <div class="mermaid-host" data-rendered="1">c</div>`);
    resetMermaidHosts(el);
    expect(el.querySelectorAll(".mermaid-host[data-rendered]").length).toBe(0);
    expect(el.querySelectorAll(".mermaid-host").length).toBe(3);
  });

  it("mermaid가 없는 문서에서 아무것도 건드리지 않는다", () => {
    const el = hosts(`<p>본문만 있다</p>`);
    resetMermaidHosts(el);
    expect(el.innerHTML).toContain("본문만 있다");
  });
});

describe("renderMermaidIn", () => {
  // 테마 전환·노트 전환마다 불리는 경로다. 대상이 없을 때 조용히 빠져야 한다.
  it("대상이 없으면 즉시 반환한다", () => {
    const el = hosts(`<div class="mermaid-host" data-rendered="1">이미 렌더됨</div>`);
    const before = el.innerHTML;
    renderMermaidIn(el);
    expect(el.innerHTML).toBe(before);
  });
});

describe("renderHost 실패 처리", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  /**
   * 회귀 방어 — mermaid 파싱이 실패하면 mermaid가 자기 에러 그림("Syntax error in text"
   * 폭탄)을 `document.body`의 임시 div에 그려 넣고 정리하지 않는다. 그 노드는 노트를
   * 바꿔도 화면 하단에 남는다. suppressErrorRendering으로 그 경로를 막았는지 본다.
   */
  it("파싱 실패 시 body에 mermaid 임시 노드를 남기지 않는다", async () => {
    // happy-dom의 IntersectionObserver는 콜백을 부르지 않는다 → 동기 렌더 경로로 태운다
    vi.resetModules();
    vi.stubGlobal("IntersectionObserver", undefined);
    const { renderMermaidIn } = await import("./mermaid-runtime");

    const el = hosts(
      `<div class="mermaid-host" data-source="이건 어떤 다이어그램 문법도 아니다"></div>`,
    );
    document.body.appendChild(el);
    renderMermaidIn(el);

    const host = el.querySelector<HTMLElement>(".mermaid-host")!;
    await vi.waitFor(() => expect(host.dataset.rendered).toBe("error"), {
      timeout: 20_000,
    });

    expect(host.querySelector(".mermaid-error")).not.toBeNull();
    // mermaid 임시 노드 이름 규칙: svg `#{id}` · div `#d{id}` · iframe `#i{id}` (id는 `m-…`)
    expect(
      document.querySelectorAll('[id^="m-"], [id^="dm-"], [id^="im-"]').length,
    ).toBe(0);
  }, 30_000);
});
