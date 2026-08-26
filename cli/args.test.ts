import { describe, it, expect } from "vitest";
import { parseArgs, UsageError } from "./args.ts";
import { COMMANDS } from "./spec.ts";
import { HANDLERS } from "./handlers.ts";

/**
 * 인자 파싱 — CLI에서 **틀리면 조용히 다른 일을 하는** 부분이라 여기만은 촘촘히 고정한다.
 */

describe("명령 해소", () => {
  it("알려진 명령을 찾는다", () => {
    expect(parseArgs(["status"]).command.name).toBe("status");
  });

  it("모르는 명령은 소리내어 죽는다", () => {
    expect(() => parseArgs(["serach"])).toThrow(UsageError);
    expect(() => parseArgs(["serach"])).toThrow(/모르는 명령/);
  });

  it("인자 없이 부르면 루트 도움말 신호(빈 메시지)", () => {
    // 빈 메시지는 "오류가 아니라 도움말"이라는 약속이다 — `main.ts`가 그걸로 갈린다.
    expect(() => parseArgs([])).toThrow(UsageError);
    try {
      parseArgs([]);
    } catch (e) {
      expect((e as UsageError).message).toBe("");
    }
  });

  it("명령 없이 옵션만 주면 죽는다", () => {
    expect(() => parseArgs(["--json"])).toThrow(/명령이 없다/);
  });
});

describe("옵션 파싱", () => {
  it("--key value 와 --key=value 가 같다", () => {
    expect(parseArgs(["search", "q", "--tag", "tech"]).options.tag).toBe("tech");
    expect(parseArgs(["search", "q", "--tag=tech"]).options.tag).toBe("tech");
  });

  it("불리언 플래그", () => {
    expect(parseArgs(["search", "q", "--json"]).options.json).toBe(true);
  });

  it("불리언에 값을 주면 죽는다", () => {
    expect(() => parseArgs(["search", "q", "--json=yes"])).toThrow(/값을 받지 않는/);
  });

  it("반복 키는 배열이 된다", () => {
    const o = parseArgs(["search", "q", "--exclude", "a", "--exclude", "b"]).options;
    expect(o.exclude).toEqual(["a", "b"]);
  });

  it("숫자 옵션은 숫자로", () => {
    expect(parseArgs(["search", "q", "--limit", "25"]).options.limit).toBe(25);
  });

  it("숫자가 아니면 죽는다 — 빈 문자열 포함", () => {
    // `Number("")`는 0이다. 삼키면 `--limit`이 조용히 1로 클램프된다.
    expect(() => parseArgs(["search", "q", "--limit", "abc"])).toThrow(/숫자가 아니다/);
    expect(() => parseArgs(["search", "q", "--limit="])).toThrow(/숫자가 아니다/);
  });

  it("⭐ 모르는 옵션은 조용히 무시하지 않는다", () => {
    // 무시하면 기본값으로 돈 결과를 요청한 결과로 오인한다. 그럴듯해서 더 나쁘다.
    expect(() => parseArgs(["search", "q", "--limt", "5"])).toThrow(/모르는 옵션: --limt/);
  });

  it("값이 빠지면 다음 옵션을 삼키지 않는다", () => {
    // `--tag --json`을 그냥 두면 `--json`이 사라진 채 돌고, 왜 사람용 출력이 나오는지 모른다.
    expect(() => parseArgs(["search", "q", "--tag", "--json"])).toThrow(/값이 필요하다/);
    expect(() => parseArgs(["search", "q", "--tag"])).toThrow(/값이 필요하다/);
  });

  it("전역 옵션은 모든 명령에서 받는다", () => {
    expect(parseArgs(["status", "--vault", "/v"]).options.vault).toBe("/v");
    expect(parseArgs(["list", "tags", "--json"]).options.json).toBe(true);
  });
});

describe("위치 인자", () => {
  it("필수 인자가 없으면 죽는다", () => {
    expect(() => parseArgs(["backlinks"])).toThrow(/<노트>가 필요하다/);
  });

  it("선택 인자는 없어도 된다", () => {
    expect(parseArgs(["search"]).positional).toEqual([]);
  });

  it("--help면 필수 인자를 요구하지 않는다", () => {
    // 사용법을 보려는데 인자를 내놓으라고 하면 앞뒤가 바뀐다.
    expect(parseArgs(["backlinks", "--help"]).help).toBe(true);
  });

  it("`--` 뒤는 전부 위치 인자다", () => {
    // 하이픈으로 시작하는 노트 이름을 옵션으로 오인하지 않게 한다.
    expect(parseArgs(["backlinks", "--", "--이상한이름"]).positional).toEqual(["--이상한이름"]);
  });
});

describe("표면 정의와 구현의 짝", () => {
  it("⭐ spec의 모든 명령에 핸들러가 있다", () => {
    // 없으면 도움말에는 보이는데 부르면 아무 일도 안 일어난다.
    const missing = COMMANDS.filter((c) => !HANDLERS[c.name]).map((c) => c.name);
    expect(missing).toEqual([]);
  });

  it("⭐ 핸들러는 전부 spec에 있다", () => {
    // 반대쪽도 막는다 — 도움말에 없는 숨은 명령이 생기지 않게.
    const names = new Set(COMMANDS.map((c) => c.name));
    const orphan = Object.keys(HANDLERS).filter((n) => !names.has(n));
    expect(orphan).toEqual([]);
  });
});
