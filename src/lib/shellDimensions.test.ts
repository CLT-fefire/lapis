import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MIN_SIDEBAR_WIDTH, MIN_CONTEXT_WIDTH } from "./stores/layout";

/**
 * 셸 치수가 **CSS 와 TS 두 곳에 적혀 있다.**
 *
 * 3.0 에서 접힘이 "폭 0"에서 "34px 스트립"으로 바뀌면서 그 숫자가 둘로 갈렸다:
 *
 * - `app.css` 의 `--collapsed-strip-w` — 스트립 버튼의 실제 폭
 * - `+page.svelte` 의 `COLLAPSED_STRIP` — 그리드 컬럼에 넣는 px 값
 *
 * ⚠️ 갈리면 **접힌 사이드바 폭과 그 안의 버튼 폭이 어긋난다.** 둘 다 34 근처라 눈에
 * 잘 안 띄고, 에러도 없다. 그래서 여기서 못 박는다.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");
const CSS = read("../app.css");
const PAGE = read("../routes/+page.svelte");

function cssVar(name: string): number {
  const m = CSS.match(new RegExp(`${name}:\\s*(\\d+)px`));
  expect(m, `${name} 를 app.css 에서 못 찾았다`).not.toBeNull();
  return Number(m![1]);
}

describe("접힘 스트립 폭", () => {
  it("CSS 와 TS 가 같은 숫자다", () => {
    const css = cssVar("--collapsed-strip-w");
    const m = PAGE.match(/COLLAPSED_STRIP = (\d+)/);
    expect(m, "+page.svelte 에서 COLLAPSED_STRIP 을 못 찾았다").not.toBeNull();
    expect(Number(m![1]), "app.css 의 --collapsed-strip-w 와 달라졌다").toBe(css);
  });

  /**
   * ⚠️ 펼친 폭의 **하한이 접힘 폭보다 커야** 한다. 안 그러면 펼친 사이드바가 접힌
   * 것보다 좁을 수 있고, 접기/펼치기가 뒤집혀 보인다.
   */
  it("펼침 하한이 접힘 폭보다 넓다", () => {
    const strip = cssVar("--collapsed-strip-w");
    expect(MIN_SIDEBAR_WIDTH).toBeGreaterThan(strip);
    expect(MIN_CONTEXT_WIDTH).toBeGreaterThan(strip);
  });
});

describe("셸 높이", () => {
  /**
   * ⚠️ 상단바·상태바 높이는 **밀도를 따르지 않는다**(창 크롬은 OS 관례). 밀도 블록
   * 안으로 들어가면 조밀 모드에서 캡션 버튼이 44px 히트 타깃 아래로 내려간다.
   */
  it("밀도 블록 안에서 재정의되지 않는다", () => {
    const density = CSS.match(/:root\[data-density="[a-z]+"\]\s*\{[^}]*\}/g) ?? [];
    expect(density.length, "밀도 블록을 못 찾았다").toBeGreaterThan(0);
    for (const block of density) {
      expect(block, "셸 치수가 밀도를 따라간다").not.toMatch(/--titlebar-h|--statusbar-h|--collapsed-strip-w/);
    }
  });

  it("상단바·상태바 높이가 정의돼 있다", () => {
    expect(cssVar("--titlebar-h")).toBeGreaterThan(0);
    expect(cssVar("--statusbar-h")).toBeGreaterThan(0);
  });
});
