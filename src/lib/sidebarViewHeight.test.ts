import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 사이드바 뷰의 **높이 전제**.
 *
 * ## ⚠️ 왜 가드가 필요한가
 *
 * 파일 트리는 가상 스크롤이고, 그 컨테이너가 `position: absolute; inset: 0` 이다.
 * `inset: 0` 은 **부모가 높이를 갖고 있을 때만** 뜻이 있다.
 *
 * v2.x 에서 그 높이는 아코디언이 줬다(섹션마다 고정 px). 3.0 에서 아코디언을 없애면서
 * 그 전제가 같이 사라질 뻔했다 — 사라지면 트리가 내용만큼 자라고 **네이티브 휠 스크롤이
 * 죽는데, 에러는 안 난다.** 화면은 그려지고 스크롤만 안 된다.
 *
 * happy-dom 에는 레이아웃 엔진이 없어 이걸 DOM 으로 못 본다. 소스를 읽는 쪽이 정직하다.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");

const VIEW = read("./SidebarView.svelte");
const SIDEBAR = read("./Sidebar.svelte");

/** 선택자 하나의 선언 블록. 주석은 이미 CSS 밖이라 따로 지울 게 없다. */
function rule(css: string, selector: string): string {
  const i = css.indexOf(selector + " {");
  if (i === -1) return "";
  return css.slice(i, css.indexOf("}", i));
}

describe("뷰 본문이 높이를 준다", () => {
  it("소스를 실제로 읽었다", () => {
    expect(VIEW).toContain(".view-body");
    expect(SIDEBAR).toContain(".files-pane");
  });

  /** flex 컬럼이 아니면 자식의 `flex: 1` 이 아무 일도 안 한다. */
  it(".view-body 가 flex 컬럼이다", () => {
    const r = rule(VIEW, ".view-body");
    expect(r).toContain("display: flex");
    expect(r).toContain("flex-direction: column");
  });

  /** ⚠️ `min-height: 0` 이 없으면 flex 자식의 기본값(auto)이 부모를 밀어낸다. */
  it(".view-body 에 min-height: 0 이 있다", () => {
    expect(rule(VIEW, ".view-body")).toContain("min-height: 0");
  });

  it(".files-pane 이 잔여 높이를 받는다", () => {
    const r = rule(SIDEBAR, ".files-pane");
    expect(r).toContain("flex: 1");
    expect(r).toContain("min-height: 0");
    expect(r).toContain("position: relative");
  });

  /** 가상 스크롤이 그 높이에 기댄다 — 짝이 맞는지 본다. */
  it("가상 컨테이너가 inset: 0 을 쓴다", () => {
    expect(SIDEBAR).toContain("inset: 0");
  });
});
