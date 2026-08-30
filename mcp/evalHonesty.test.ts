import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildCases } from "./searchEval.ts";
import type { VaultCache } from "../core/cache.ts";

/**
 * **측정 도구가 아무것도 안 재고 통과라고 말하지 않는지** 본다.
 *
 * ## 왜 이게 있나
 *
 * `./mcp/lapis-eval --vault <경로>`를 돌렸더니 **케이스 0건**으로 품질 칸이 전부 `NaN%`인데
 * 마지막 줄에 ✅를 내고 종료 코드 0으로 끝났다.
 *
 * `Number("--vault")`가 `NaN`, `slice(0, NaN)`이 빈 배열, 그리고 판정부는 지연 예산만 본다.
 * 세 가지가 겹쳐서 **"쟀다"와 "안 쟀다"가 구분되지 않았다.**
 *
 * 측정 도구는 다른 판단의 근거다. 토크나이저를 바꾸고 이걸 돌려 "R@1 그대로"를 봤다면
 * 실제로는 아무것도 비교하지 않은 것이고, `CACHE_VERSION` bump가 걸린 결정에서 그 결론은
 * 되돌리기가 비싸다.
 *
 * ⚠️ 하네스 자체는 실제 vault와 캐시가 있어야 돌아서 여기서 끝까지 실행할 수 없다.
 * 그래서 **함정 지점(`buildCases`)은 직접 호출**하고, **엮이는 방식은 소스를 읽어** 본다.
 */

const src = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf-8");

/**
 * 주석을 걷어낸 소스. **살아 있는 코드만** 본다.
 *
 * ⚠️ 이게 없으면 가드가 자기 자신을 잡는다. 두 러너의 주석에 "예전엔 `Number(process.argv[2])`
 * 였다"는 설명이 들어 있어서, 코드를 다 고쳤는데도 금지 패턴이 검출됐다. **왜 이렇게 됐는지를
 * 적어 두는 것과 그 코드가 살아 있는 것은 다르다** — 가드가 그 둘을 구분해야 주석을 지우지
 * 않게 된다.
 */
const code = (name: string) =>
  src(name)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** `buildCases`는 `vc.infos`만 읽는다 — 빈 vault면 파일 IO 없이 빈 결과가 나온다. */
const emptyVault = { root: "/v", infos: [] } as unknown as VaultCache;

describe("buildCases — 조용히 0건이 되지 않는다", () => {
  /**
   * ⚠️ **이게 원래 결함이다.** `slice(0, NaN)`을 JS는 `slice(0, 0)`으로 읽는다.
   * 예외도 경고도 없이 빈 배열이 나오고, 그게 "케이스 0건"이 됐다.
   */
  it("NaN이면 던진다 — 빈 배열을 돌려주지 않는다", () => {
    expect(() => buildCases(emptyVault, Number("--vault"))).toThrow(RangeError);
    expect(() => buildCases(emptyVault, NaN)).toThrow(RangeError);
  });

  it("0 이하·소수도 던진다", () => {
    for (const bad of [0, -1, 1.5, Infinity]) {
      expect(() => buildCases(emptyVault, bad), String(bad)).toThrow(RangeError);
    }
  });

  it("정상 값은 던지지 않는다 — 검사가 전부를 막지는 않는다", () => {
    expect(() => buildCases(emptyVault, 10)).not.toThrow();
    // 빈 vault라 케이스는 0건이다. 그건 정상이고, 판정은 러너가 한다.
    expect(buildCases(emptyVault, 10)).toEqual([]);
  });
});

describe("lapis-eval 러너", () => {
  const run = src("evalRun.ts");

  /** ⚠️ 카나리아 — 파일을 못 읽으면 아래 단언이 빈 문자열을 보고 통과한다. */
  it("러너 소스를 실제로 읽었다", () => {
    expect(run.length).toBeGreaterThan(1000);
    expect(run).toContain("지연 예산");
  });

  /**
   * 케이스가 0건이면 **통과라고 말하기 전에** 죽어야 한다. 순서가 중요하다 —
   * 성공 출력 뒤에 검사를 두면 ✅를 이미 낸 뒤다.
   */
  it("0건 검사가 성공 출력보다 앞에 있다", () => {
    const check = run.indexOf("clean.length === 0");
    const ok = run.indexOf("✅ 지연 예산 통과");
    expect(check, "0건 검사가 없다").toBeGreaterThan(-1);
    expect(ok).toBeGreaterThan(-1);
    expect(check, "0건 검사가 성공 출력보다 뒤에 있다").toBeLessThan(ok);
  });

  it("0건은 종료 코드 2다 — 사용법 오류와 같은 값", () => {
    const seg = run.slice(run.indexOf("clean.length === 0"), run.indexOf("const DIST"));
    expect(seg).toContain("process.exit(2)");
  });

  /** `Number(process.argv[...])` 직접 호출로 돌아가면 같은 함정에 다시 빠진다. */
  it("argv를 직접 Number()로 읽지 않는다", () => {
    expect(code("evalRun.ts")).not.toMatch(/Number\(\s*process\.argv/);
    expect(run).toContain("readDevArgs");
  });

  it("--vault 를 실제로 resolveVault 에 넘긴다", () => {
    // 예전엔 `resolveVault()` 였다 — `--vault`가 아무 일도 안 하면서 위치 인자만 먹었다.
    expect(run).toMatch(/resolveVault\(\s*args\.vault\s*\)/);
  });
});

describe("lapis-bench 러너", () => {
  const bench = src("benchRun.ts");

  it("러너 소스를 실제로 읽었다", () => {
    expect(bench.length).toBeGreaterThan(1000);
  });

  /**
   * 같은 한 줄(`Math.max(200, Number(argv[2] ?? 3000))`)을 갖고 있었다.
   * `Math.max(200, NaN)`도 **NaN**이라 표본이 조용히 빈다.
   */
  it("argv를 직접 Number()로 읽지 않는다", () => {
    expect(code("benchRun.ts")).not.toMatch(/Number\(\s*process\.argv/);
    expect(bench).toContain("readDevArgs");
  });

  it("--vault 를 실제로 resolveVault 에 넘긴다", () => {
    expect(bench).toMatch(/resolveVault\(\s*args\.vault\s*\)/);
  });
});
