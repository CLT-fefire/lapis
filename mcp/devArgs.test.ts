import { describe, it, expect } from "vitest";
import { parseDevArgs, DevArgsError } from "./devArgs.ts";

/**
 * 개발 도구(`lapis-eval` · `lapis-bench`)의 인자 파싱.
 *
 * ## 왜 이게 생겼나
 *
 * `./mcp/lapis-eval --vault <경로>`를 돌렸더니 **케이스 0건**으로 아무것도 안 재고
 * 마지막 줄에 ✅를 냈다. `--vault`는 지원되지 않는 옵션인데 **위치 인자 자리를 먹었고**,
 * `Number("--vault")`가 `NaN`, `slice(0, NaN)`이 빈 배열이 됐다. 예외도 경고도 없었다.
 *
 * 측정 도구는 다른 판단의 근거다. 토크나이저를 바꾸고 이걸 돌려 "R@1 그대로"를 봤다면
 * **실제로는 아무것도 비교하지 않은 것**이고, `CACHE_VERSION` bump가 걸린 결정에서
 * 그 결론은 되돌리기가 비싸다.
 *
 * ⚠️ `cli/README.md`가 이미 적어 둔 원칙을 형제 도구가 어기고 있었다:
 * "모르는 옵션을 무시하면 기본값으로 돈 결과를 요청한 결과로 오인한다."
 */

const ok = (argv: string[]) => parseDevArgs(argv, { defaultSample: 150, name: "lapis-eval" });

describe("위치 인자 — 샘플 수", () => {
  it("없으면 기본값", () => {
    expect(ok([]).sample).toBe(150);
  });

  it("정수를 받는다", () => {
    expect(ok(["40"]).sample).toBe(40);
  });

  /**
   * ⚠️ **이게 원래 결함이다.** `Number("--vault")`는 `NaN`이고, 그게 그대로 흘러가
   * 케이스 0건이 됐다. 여기서 죽어야 한다.
   */
  it("숫자가 아니면 던진다 — NaN이 흘러가지 않는다", () => {
    for (const bad of ["--vault", "abc", "12abc", ""]) {
      expect(() => ok([bad]), bad).toThrow(DevArgsError);
    }
  });

  it("0 이하와 소수는 던진다", () => {
    for (const bad of ["0", "-5", "1.5"]) {
      expect(() => ok([bad]), bad).toThrow(DevArgsError);
    }
  });
});

describe("--vault", () => {
  it("경로를 받는다", () => {
    expect(ok(["--vault", "/v"]).vault).toBe("/v");
  });

  it("위치 인자와 같이 쓸 수 있다 — 순서와 무관하다", () => {
    expect(ok(["40", "--vault", "/v"])).toMatchObject({ sample: 40, vault: "/v" });
    expect(ok(["--vault", "/v", "40"])).toMatchObject({ sample: 40, vault: "/v" });
  });

  it("값이 없으면 던진다", () => {
    expect(() => ok(["--vault"])).toThrow(DevArgsError);
    expect(() => ok(["40", "--vault"])).toThrow(DevArgsError);
  });

  /**
   * 다음 것이 옵션처럼 생겼으면 값이 아니다 — 조용히 `-x`를 경로로 삼고 "vault를 못 찾음"
   * 으로 죽으면, 원인이 옵션 오타라는 게 안 보인다.
   *
   * ⚠️ `--vault --help`는 예외로 **도움말이 이긴다**(아래 `--help` 절). 도움말을 물었으면
   * 인자가 어떻게 생겼든 도움말을 내는 게 맞다.
   */
  it("다음 것이 옵션이면 값으로 삼지 않는다", () => {
    expect(() => ok(["--vault", "-x"])).toThrow(DevArgsError);
    expect(ok(["--vault", "--help"]).help).toBe(true);
  });

  it("안 주면 undefined — 호출부가 resolveVault의 자동 선택에 맡긴다", () => {
    expect(ok([]).vault).toBeUndefined();
  });
});

describe("모르는 것은 거절한다", () => {
  /** `lapis`와 같은 규율. 무시하면 "왜 아무 일도 안 일어나지"가 된다. */
  it("모르는 옵션은 던진다", () => {
    expect(() => ok(["--limt", "5"])).toThrow(DevArgsError);
    expect(() => ok(["-v"])).toThrow(DevArgsError);
  });

  it("위치 인자가 둘이면 던진다", () => {
    expect(() => ok(["40", "50"])).toThrow(DevArgsError);
  });
});

describe("--help", () => {
  it("도움말 요청을 알린다", () => {
    expect(ok(["--help"]).help).toBe(true);
    expect(ok(["-h"]).help).toBe(true);
    expect(ok([]).help).toBe(false);
  });

  /**
   * ⚠️ `--help`가 다른 인자와 섞여도 **도움말이 이긴다.** 예전엔 `--help`가 위치 인자로
   * 먹혀서 전체 하네스가 0건으로 돌고 ✅를 냈다.
   */
  it("다른 인자보다 우선한다 — 검사보다 먼저 본다", () => {
    expect(ok(["--help", "--모르는옵션"]).help).toBe(true);
    expect(ok(["abc", "--help"]).help).toBe(true);
  });
});

describe("오류 메시지", () => {
  /** 도구 이름이 들어가야 어느 도구가 거절했는지 안다. */
  it("도구 이름과 사용법을 담는다", () => {
    try {
      ok(["--limt"]);
      expect.unreachable("던졌어야 한다");
    } catch (e) {
      expect(e).toBeInstanceOf(DevArgsError);
      const msg = (e as DevArgsError).message + (e as DevArgsError).usage;
      expect(msg).toContain("lapis-eval");
      expect(msg).toContain("--vault");
    }
  });
});
