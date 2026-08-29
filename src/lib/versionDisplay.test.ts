import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 버전은 **한 곳에서만** 보인다.
 *
 * ## 무슨 일이 있었나
 *
 * 한때 topbar(노트 헤더)와 설정 두 곳에 `v2.0.0` 이 같이 떴다. 옮겼다고 커밋에 적어
 * 놓고 **실제로는 추가만 하고 원래 자리를 안 지웠던** 것이다. 앱을 띄워 보고서야 찾았다
 * (`4870c54`, 2026-08-27).
 *
 * 그 커밋이 topbar 마크업을 뺐는데 — **`$state` 선언과 `getVersion()` 호출은 남겼다.**
 * 그래서 그 뒤로 `+page.svelte` 는 기동할 때마다 버전을 읽어 아무도 안 보는 변수에
 * 넣고 있었다. 에러는 안 났다. 린터 경고 한 줄이 전부였고 게이트는 통과했다.
 *
 * ## 두 가지를 못 박는다
 *
 * 1. **보이는 자리는 하나** — 두 곳이 되면 언젠가 다른 값이 뜬다.
 * 2. **쓰기만 남기지 않는다** — 독자를 지울 때 작성자도 같이 간다. 안 그러면
 *    "되살리려던 기능"인지 "지우다 만 것"인지 다음 사람이 구별할 수 없다.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");

const page = read("../routes/+page.svelte");
const settings = read("./SettingsModal.svelte");

describe("보이는 자리는 하나", () => {
  it("설정이 버전을 낸다", () => {
    expect(settings).toMatch(/nav-version/);
    expect(settings).toMatch(/v\{appVersion\}/);
  });

  /** 🔴 `4870c54` 가 뺀 자리다. 되돌아오면 두 곳에 뜬다. */
  it("본문 화면은 버전을 안 낸다", () => {
    expect(page, "topbar 에 버전 라벨이 돌아왔다").not.toMatch(/\{appVersion\}/);
    expect(page).not.toMatch(/class="phase"/);
  });
});

describe("쓰기만 남기지 않는다", () => {
  /**
   * ⚠️ 이게 무너졌던 자리다 — 마크업만 지우고 `let appVersion = $state(...)` 와
   * `appVersion = await getVersion()` 이 남았다.
   */
  it("본문 화면이 appVersion 을 아예 안 갖는다", () => {
    expect(page, "안 보이는데 값을 담아 둔다").not.toMatch(/\bappVersion\b/);
  });
});

/**
 * ⚠️ **출처는 Tauri 런타임 하나다.**
 *
 * `getVersion()` 은 Cargo.toml 의 값을 준다. `package.json` 이나 `tauri.conf.json` 을
 * 읽으면 셋이 어긋났을 때 **틀린 버전을 자신 있게 표시**하게 된다 — 버그 리포트가
 * 엉뚱한 빌드를 가리키기 시작하고, 그게 가장 비싼 종류의 오답이다.
 */
describe("출처는 하나", () => {
  it("설정이 런타임에서 읽는다", () => {
    expect(settings).toMatch(/from "@tauri-apps\/api\/app"/);
    expect(settings).toMatch(/getVersion\(\)/);
  });

  /** 사용 기록에도 버전이 들어간다 — 같은 출처여야 "어느 버전에서 났나"가 맞다. */
  it("세션 기록도 같은 출처를 쓴다", () => {
    // ⚠️ import 줄이 아니라 **호출부**를 찾는다 — 인자를 넘기는 자리다.
    const at = page.indexOf("logSessionStart(v,");
    expect(at, "세션 시작 기록 호출부를 못 찾았다").toBeGreaterThan(-1);
    expect(page.slice(Math.max(0, at - 200), at + 120)).toMatch(/getVersion\(\)/);
  });
});
