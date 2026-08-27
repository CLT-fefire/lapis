import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 사용자 정의 CSS의 **배선** — 소스를 읽어 본다.
 *
 * ⚠️ `userCss.dom.test.ts`와 갈라 둔 이유: `dom` 프로젝트는 `conditions: ["browser"]`라
 * `import.meta.url`이 file URL이 아니고 `fileURLToPath`가 던진다. 소스를 읽는 검사는
 * DOM이 필요 없으니 `node` 쪽에 둔다.
 */
const src = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");

const page = src("../routes/+page.svelte");
const layout = src("../routes/+layout.svelte");

describe("배선", () => {
  /**
   * ⚠️ **패닉 키는 다른 어떤 분기보다 먼저 와야 한다.** 사용자 CSS가 화면을 못 쓰게 만든
   * 상황에서 되돌리는 1차 방어선이라, `inEditing` 판정이나 `resolveShortcut` 뒤에 두면
   * 그 판정이 의존하는 것들이 같이 망가졌을 때 안 듣는다.
   */
  it("패닉 검사가 keymap 조회보다 앞에 있다", () => {
    const handler = page.slice(page.indexOf("function handleGlobalKey"));
    const panic = handler.indexOf("isPanicChord");
    const resolve = handler.indexOf("resolveShortcut");
    expect(panic, "핸들러에 패닉 검사가 없다").toBeGreaterThan(-1);
    expect(resolve).toBeGreaterThan(-1);
    expect(panic, "패닉 검사가 keymap 조회보다 뒤에 있다").toBeLessThan(resolve);
  });

});

/**
 * 주입은 **루트 레이아웃**에 있어야 한다.
 *
 * ⚠️ 처음엔 `+page.svelte`에 뒀다. 그러면 그 라우트가 마운트된 동안에만 주입된다 —
 * `/dev/preview`에서 테마를 골라 보니 **store는 바뀌는데 화면이 안 따라왔다.** 앱 전체에
 * 걸리는 것이라 앱 전체를 감싸는 곳에 있어야 한다.
 */
describe("주입 위치", () => {

  it("루트 레이아웃이 store 변화를 주입으로 잇는다", () => {
    expect(layout).toMatch(/applyUserCss\(\s*\$customCss,\s*\$customCssEnabled\s*\)/);
    expect(layout).toMatch(/applyColorThemeCss\(\s*themeCss\(\s*\$colorTheme\s*\)\s*\)/);
  });

  /**
   * ⚠️ **테마가 사용자 CSS보다 먼저.** 둘 다 `:root` 토큰을 덮어쓰고 특이도가 같아서
   * 나중 것이 이긴다 — 사용자 CSS가 프리셋 위에 얹혀야 한다.
   */
  it("테마를 사용자 CSS보다 먼저 주입한다", () => {
    // ⚠️ 이름만 찾으면 **import 줄**이 걸린다 — 거기엔 둘이 한 줄에 있어 순서가 뜻이
    //    없다. 여는 괄호까지 붙여 호출부를 찾는다.
    const theme = layout.indexOf("applyColorThemeCss(themeCss");
    const user = layout.indexOf("applyUserCss($");
    expect(theme).toBeGreaterThan(-1);
    expect(theme, "사용자 CSS가 테마보다 먼저 주입된다").toBeLessThan(user);
  });

  /** 한 곳에서만 주입한다 — 두 곳이면 순서가 상황에 따라 갈린다. */
  it("페이지 쪽에는 주입이 남아 있지 않다", () => {
    expect(page).not.toContain("applyUserCss($");
    expect(page).not.toContain("applyColorThemeCss(themeCss");
  });
});
