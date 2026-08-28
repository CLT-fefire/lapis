import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 사용 로그의 **배선**.
 *
 * ⚠️ 이 가드가 없으면 로그는 조용히 반쪽이 된다. 새 `console.error` 하나가 들어와도
 * 화면은 멀쩡하고 테스트도 통과하며, **몇 달 뒤 분석할 때** 그 오류만 통계에 없다.
 * 그때는 되돌릴 수 없다 — 안 담긴 것은 안 담긴 것이다.
 */

const SRC = fileURLToPath(new URL("./", import.meta.url));
const ROOT = fileURLToPath(new URL("../", import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "paraglide") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.(ts|svelte)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

const FILES = [...sources(SRC), ...sources(join(ROOT, "routes"))].filter(
  (f) => !f.replace(/\\/g, "/").endsWith("stores/usage.ts"),
);

describe("console 대신 logError/logWarn", () => {
  /**
   * 🔴 릴리스 빌드에는 devtools 가 없다. `console.error` 로만 남기면 **아무도 안 읽는
   * 곳**에 쓰는 것이고, 그게 이 앱이 96곳에서 조용히 실패하던 이유였다.
   */
  it("console.error / console.warn 이 남아 있지 않다", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const body = readFileSync(f, "utf-8");
      if (/console\.(error|warn)\(/.test(body)) {
        offenders.push(f.replace(ROOT, "").replace(/\\/g, "/"));
      }
    }
    expect(
      offenders,
      `logError / logWarn 을 쓴다 — console 은 릴리스에서 아무도 안 읽는다:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  /** ⚠️ 카나리아 — 파일을 실제로 읽었는지. 0개를 읽고 통과하면 아무것도 안 본 것이다. */
  it("소스를 실제로 읽었다", () => {
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES.some((f) => f.endsWith("vault.ts"))).toBe(true);
  });

  /**
   * `at` 은 모듈 경로다. 빈 문자열이면 통계에서 자리를 알 수 없다.
   * ⚠️ 파일을 옮기면 여기도 옮겨야 한다 — 그래서 형태만 본다(정확한 값은 안 본다).
   */
  it("logError 의 첫 인자가 비어 있지 않다", () => {
    const bad: string[] = [];
    for (const f of FILES) {
      const body = readFileSync(f, "utf-8");
      for (const m of body.matchAll(/log(?:Error|Warn)\(\s*(["'`])(.*?)\1/g)) {
        if (m[2].trim() === "") bad.push(f.replace(ROOT, "").replace(/\\/g, "/"));
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("명령 입구 배선", () => {
  const palette = readFileSync(join(SRC, "CommandPalette.svelte"), "utf-8");
  const page = readFileSync(join(ROOT, "routes", "+page.svelte"), "utf-8");
  const rail = readFileSync(join(SRC, "SidebarRail.svelte"), "utf-8");

  /**
   * 🔴 **입구가 이 통계의 요점이다.** "파일 열기를 400번" 은 쓸모가 적고
   * "400번 중 380번이 `⌘P`, 레일은 3번" 은 레일을 고칠지 말지를 정해 준다.
   */
  it("팔레트가 palette 로 기록한다", () => {
    expect(palette).toMatch(/logCommand\([^)]*"palette"/);
  });

  it("단축키가 keymap 으로 기록한다", () => {
    expect(page).toMatch(/logCommand\([^)]*"keymap"/);
  });

  it("레일이 rail 로 기록한다", () => {
    expect(rail).toMatch(/logCommand\([^)]*"rail"/);
  });
});
