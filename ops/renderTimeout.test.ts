import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { RENDER_TIMEOUT_MS_DEFAULT } from "./renderRequest";

/**
 * 🔴 **부르는 쪽 타임아웃과 앱의 포기 시각은 한 계약이다.**
 *
 * 앱은 요청을 아무도 안 받아가면 **실패 파일**을 써서 이유를 말한다
 * (`clirender::render_window_if_unclaimed`). 그런데 부르는 쪽이 그보다 **먼저** 포기하면
 * 그 이유가 영영 안 읽힌다 — 사용자는 "아무도 이 요청을 받지 않았다" 대신
 * "앱이 N ms 안에 결과를 안 냈다"를 본다. **정확한 진단이 필요한 바로 그때 사라진다.**
 *
 * ## ⚠️ 실측 (2026-08-30)
 *
 * 프런트가 요청을 안 받아가는 버림 빌드로 실물에서 걸어 봤다:
 *
 * ```
 * 담음 → 받아간 창이 없다 → 새 창 w2 → 포기: 새 창을 띄웠는데도 아무도 이 요청을 받지 않았다
 * 실패 파일이 생긴 시각: 약 18초
 * ```
 *
 * 그때 부르는 쪽 기본값은 **20초**였다 — 여유가 **2초**뿐이었다. 창을 띄우는 데 조금만
 * 더 걸리면 진단이 뒤집힌다.
 *
 * ## ⚠️ 왜 소스를 읽나
 *
 * 상수가 Rust 에 있어 import 할 수 없다. 숫자를 여기 옮겨 적으면 **그게 갈린다** —
 * 이 저장소가 반복해서 겪은 유형이다. 그래서 `lib.rs` 를 읽어 푼다.
 * (`dangerText.test.ts` 가 `app.css` 를 읽는 것과 같은 방식이다.)
 */

const LIB_RS = readFileSync(
  path.join(process.cwd(), "src-tauri", "src", "lib.rs"),
  "utf8",
);

/** `const NAME: u64 = 15_000;` 에서 숫자를 뽑는다. `_` 구분자를 허용한다. */
function rustConst(name: string): number {
  const m = new RegExp(`const\\s+${name}\\s*:\\s*u64\\s*=\\s*([0-9_]+)`).exec(LIB_RS);
  if (!m) throw new Error(`lib.rs 에서 ${name} 를 못 찾았다 — 이름이 바뀌었나`);
  return Number(m[1].replace(/_/g, ""));
}

describe("앱이 포기하기 전에 부르는 쪽이 먼저 포기하면 안 된다", () => {
  it("상수를 실제로 읽어 온다", () => {
    // ⚠️ 못 읽었는데 통과하는 일이 없게 — 0 이나 NaN 이면 아래 비교가 무의미해진다.
    expect(rustConst("UNCLAIMED_WAIT_MS")).toBeGreaterThan(0);
    expect(rustConst("UNCLAIMED_GIVE_UP_MS")).toBeGreaterThan(0);
  });

  /**
   * 여유 5초는 **창을 띄우고 파일을 쓰는 시간**이다. 실측에서 그 몫이 2.5초였으므로
   * 두 배쯤 잡았다. 느린 머신에서도 진단이 살아남아야 한다.
   */
  it("기본값이 앱의 포기 시각보다 최소 5초 넉넉하다", () => {
    const floor = rustConst("UNCLAIMED_WAIT_MS") + rustConst("UNCLAIMED_GIVE_UP_MS");
    expect(
      RENDER_TIMEOUT_MS_DEFAULT,
      `앱은 ${floor}ms 뒤에야 이유를 쓴다 — 그전에 포기하면 그 이유를 못 읽는다`,
    ).toBeGreaterThanOrEqual(floor + 5_000);
  });

  /** ⚠️ 반대쪽도 본다 — 한없이 크면 죽은 앱을 하염없이 기다린다. */
  it("그렇다고 무한정 기다리지는 않는다", () => {
    expect(RENDER_TIMEOUT_MS_DEFAULT).toBeLessThanOrEqual(60_000);
  });
});

/**
 * 🔴 **기본값은 한 곳에서만 나온다.** 예전엔 이 숫자가 네 곳에 적혀 있었다 —
 * `mcp/tools.ts` 의 스키마 설명과 적용부, `cli/handlers.ts`, `cli/spec.ts`.
 * 넷 중 하나만 고치면 도구마다 다르게 기다리고, 아무도 그걸 못 본다.
 */
describe("숫자가 흩어져 있지 않다", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

  for (const f of ["mcp/tools.ts", "cli/handlers.ts", "cli/spec.ts"]) {
    it(`${f} 는 숫자를 적어 두지 않는다`, () => {
      const src = read(f);
      // 20000 · 20_000 · 2e4 같은 옛 형태가 남아 있으면 갈린 것이다.
      expect(src, `${f} 에 타임아웃 숫자가 박혀 있다`).not.toMatch(/\b(20_?000|2e4|25_?000|25e3)\b/);
    });
  }
});
