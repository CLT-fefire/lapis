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
describe("배선", () => {
  const page = readFileSync(
    fileURLToPath(new URL("../routes/+page.svelte", import.meta.url)),
    "utf-8",
  );

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

  it("store 변화가 주입으로 이어진다", () => {
    expect(page).toMatch(/applyUserCss\(\s*\$customCss,\s*\$customCssEnabled\s*\)/);
  });
});
