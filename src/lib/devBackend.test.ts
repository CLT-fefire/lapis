import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * dev 가짜 백엔드의 **경계**.
 *
 * ## 🔴 이 가짜가 프로덕션에 들어가면 최악이다
 *
 * 사용자의 진짜 vault 대신 픽스처를 보여주게 된다 — 노트가 사라진 것처럼 보이고,
 * 거기서 뭔가를 쓰면 디스크에 안 남는다. **에러 없이** 그렇게 된다.
 *
 * `import.meta.env.DEV` 는 빌드 시점에 `false` 로 치환되고 번들러가 그 분기를 걷어낸다.
 * 그 사실에 기대는 것이므로 **빌드 산출물을 직접 확인**한다.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BUILD = join(ROOT, "build");

function builtFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) builtFiles(p, out);
    else if (/\.(js|html|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("가짜 백엔드는 dev 에서만", () => {
  it("가짜로 흐르는 분기가 DEV 로 막혀 있다", () => {
    const src = readFileSync(join(ROOT, "src/lib/tauri/invoke.ts"), "utf-8");
    expect(src).toMatch(/import\.meta\.env\.DEV/);
    // ⚠️ 정적 import 면 번들에 **무조건** 들어간다. 동적 import 여야 걷힌다.
    expect(src, "정적 import 는 프로덕션 번들에 남는다").toMatch(
      /await import\(["']\$lib\/dev\/fakeBackend["']\)/,
    );
    expect(src).not.toMatch(/^import .*fakeBackend/m);
  });

  /**
   * 🔴 **테스트에서 가짜가 잡히면 목이 무력해진다.**
   *
   * vitest 도 `DEV` 이고 Tauri 밖이다. 이 가드가 없으면 `invoke` 를 타는 테스트가 목 대신
   * 픽스처를 물고, 픽스처는 그럴듯한 값을 주므로 **단언이 조용히 통과한다.** 실제로
   * `usageBuffer.dom.test.ts` 가 그렇게 초록에서 빨강으로 바뀌었다(=그 전엔 헛돌았다).
   */
  it("테스트에서는 가짜를 안 쓴다", async () => {
    const { usingFakeBackend } = await import("$lib/tauri/invoke");
    expect(usingFakeBackend(), "지금 이 테스트가 가짜를 물고 있다").toBe(false);

    const src = readFileSync(join(ROOT, "src/lib/tauri/invoke.ts"), "utf-8");
    expect(src, "테스트 모드 가드가 있어야 한다").toMatch(
      /import\.meta\.env\.MODE\s*!==\s*["']test["']/,
    );
  });

  it("Tauri 안에서는 가짜를 안 쓴다", () => {
    const src = readFileSync(join(ROOT, "src/lib/tauri/invoke.ts"), "utf-8");
    // `inTauri()` 가 참이면 `usingFakeBackend()` 는 거짓이어야 한다.
    expect(src).toMatch(/import\.meta\.env\.DEV\s*&&[\s\S]{0,80}!inTauri\(\)/);
  });

  /**
   * 🔴 **빌드 산출물에 픽스처 문자열이 없어야 한다.**
   *
   * ⚠️ `build/` 가 없으면 이 단언은 **건너뛴다.** 없는 것을 통과로 세지 않으려고
   * 그 사실을 먼저 확인한다 — `npm run build` 를 한 뒤에만 뜻이 있다.
   */
  it("프로덕션 번들에 픽스처가 없다", () => {
    let exists = false;
    try {
      exists = statSync(BUILD).isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) return; // 빌드 전 — 판정하지 않는다

    const offenders: string[] = [];
    for (const f of builtFiles(BUILD)) {
      const body = readFileSync(f, "utf-8");
      // 픽스처에만 있는 문자열들.
      if (body.includes("/dev-vault") || body.includes("가짜 백엔드가 모르는 명령")) {
        offenders.push(f.replace(ROOT, ""));
      }
    }
    expect(
      offenders,
      `프로덕션 번들에 dev 픽스처가 들어갔다:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("가짜 백엔드의 태도", () => {
  const src = readFileSync(join(ROOT, "src/lib/dev/fakeBackend.ts"), "utf-8");

  /**
   * ⚠️ **모르는 명령은 던진다.** 조용히 `undefined` 를 주면 호출부가 그것을 정상으로
   * 취급하고, 무엇이 빠졌는지 알 수 없게 된다 — 가짜가 조용히 반쪽이 되는 길이다.
   */
  it("모르는 명령에 던진다", () => {
    expect(src).toMatch(/default:[\s\S]{0,200}throw new Error/);
  });

  /** 화면에 픽스처라는 표시가 있어야 한다 — 없으면 프리뷰를 실물로 착각한다. */
  it("상태바가 픽스처임을 밝힌다", () => {
    const statusbar = readFileSync(join(ROOT, "src/lib/Statusbar.svelte"), "utf-8");
    expect(statusbar).toMatch(/usingFakeBackend\(\)/);
    expect(statusbar).toMatch(/FIXTURE/);
  });
});
