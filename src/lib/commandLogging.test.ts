import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 명령 기록의 **빠진 자리**.
 *
 * ## 🔴 안 세어진 것은 "안 쓴 것"으로 보인다
 *
 * 실물 로그에서 `cmd` 가 **0건**이었다. 앱을 쓰고 있었는데도. 원인은 설정 톱니가
 * `activate()` 를 안 거치고 `openSettings` 를 직접 부른 것이었다 — 기록은 `activate()`
 * 안에 있었다.
 *
 * 그 결과 분석 문서가 "많이 쓰는 명령: 아직 기록이 없다"라고 말하면서 스무 개를 "한 번도
 * 안 쓴 명령"으로 올렸다. **틀린 것이 아니라 거꾸로**였다.
 *
 * 그래서 진입점마다 기록이 붙어 있는지를 소스로 못 박는다. 실행되는 코드를 안 보고
 * 소스를 읽는 것은 약하지만, 이 종류의 누락은 **런타임에 아무 신호도 안 낸다.**
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");

describe("진입점마다 기록이 붙어 있다", () => {
  it("레일 — 뷰 전환", () => {
    const src = read("./SidebarRail.svelte");
    expect(src).toMatch(/logCommand\(`view:\$\{key\}`, "rail"\)/);
  });

  /** 🔴 이 버튼이 `activate()` 를 안 거쳐서 `cmd` 가 통째로 비어 있었다. */
  it("레일 — 설정 톱니", () => {
    const src = read("./SidebarRail.svelte");
    expect(src, "설정 톱니가 기록을 안 남긴다").toMatch(
      /logCommand\("view:settings", "rail"\)/,
    );
  });

  it("팔레트", () => {
    expect(read("./CommandPalette.svelte")).toMatch(/logCommand\(/);
  });

  /** ⚠️ 항목마다가 아니라 **고르는 한 곳**에서 남긴다 — 새 항목을 넣을 때 빼먹지 않게. */
  it("창 메뉴 — 고르는 한 곳에서", () => {
    const src = read("./PaneMenu.svelte");
    expect(src).toMatch(/logCommand\(item\.id, "menu"\)/);
  });

  it("단축키", () => {
    expect(read("../routes/+page.svelte")).toMatch(/logCommand\(/);
  });
});

/**
 * ⚠️ **명령을 실행하는 자리는 하나여야 한다.**
 *
 * `BUILTIN_COMMANDS` 의 `run()` 을 여러 곳에서 부르면 그중 한 곳만 기록을 빠뜨려도
 * 통계가 조용히 반쪽이 된다. 지금은 팔레트 하나뿐이고, 늘어나면 여기서 걸린다.
 */
describe("명령 실행 자리", () => {
  it("`.run()` 을 부르는 곳은 팔레트뿐이다", () => {
    const palette = read("./CommandPalette.svelte");
    expect(palette).toMatch(/\.run\(\)/);
    // 팔레트에서는 실행 **전에** 기록한다 — 명령이 모달을 열고 나면 늦는다.
    const runAt = palette.indexOf(".run()");
    const logAt = palette.indexOf("logCommand(");
    expect(logAt).toBeGreaterThan(-1);
    expect(logAt, "기록이 실행보다 뒤에 있다").toBeLessThan(runAt);
  });
});
