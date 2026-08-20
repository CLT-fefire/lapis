/** 프리뷰 DOM 후처리 — 컴포넌트를 띄우지 않고 원소만 만들어 태운다. */
import { describe, expect, it } from "vitest";
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
