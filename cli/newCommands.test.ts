import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COMMANDS, GLOBAL_OPTIONS } from "./spec.ts";
import { HANDLERS } from "./handlers.ts";

/**
 * 새로 넣은 세 명령 — `read` · `stats` · `usage`.
 *
 * ## ⚠️ 명세와 핸들러가 갈리면 조용히 아무 일도 안 한다
 *
 * 명령을 명세에만 넣고 핸들러를 빼먹으면 **도움말에는 보이는데 부르면 아무 일도 안
 * 일어난다.** `headlessContract.test.ts` 가 그걸 전반적으로 막고, 여기서는 이 셋의
 * 계약을 따로 못 박는다.
 */

const NEW = ["read", "stats", "usage"] as const;

describe("명세와 핸들러", () => {
  for (const name of NEW) {
    it(`${name} 이 명세에 있다`, () => {
      expect(COMMANDS.map((c) => c.name)).toContain(name);
    });

    it(`${name} 에 핸들러가 있다`, () => {
      expect(typeof HANDLERS[name]).toBe("function");
    });
  }
});

describe("read", () => {
  const spec = COMMANDS.find((c) => c.name === "read")!;

  /** 이름으로 찾는 것이 요점이다 — 경로만 받으면 `cat` 과 다를 게 없다. */
  it("노트를 필수 인자로 받는다", () => {
    expect(spec.positional[0]?.required).toBe(true);
  });

  /** ⚠️ **기본은 본문만.** frontmatter 를 늘 붙이면 파이프마다 잘라내야 한다. */
  it("meta 는 옵션이다", () => {
    expect(spec.options.map((o) => o.name)).toContain("meta");
  });
});

describe("stats", () => {
  /** `status` 와 다른 질문이다 — 저쪽은 캐시 상태, 이쪽은 vault 내용. */
  it("인자가 없다", () => {
    const spec = COMMANDS.find((c) => c.name === "stats")!;
    expect(spec.positional).toHaveLength(0);
  });
});

describe("usage", () => {
  const spec = COMMANDS.find((c) => c.name === "usage")!;

  it("폴더를 바꿀 수 있다", () => {
    expect(spec.options.map((o) => o.name)).toContain("dir");
  });
});

/**
 * 🔴 **집계를 두 벌 만들지 않는다.**
 *
 * 앱이 `analysis.md` 를 만들 때 쓰는 것과 **같은 클래스**여야 한다. 여기서 따로 세면
 * 두 숫자가 갈리고, 갈린 통계는 둘 다 못 믿게 된다 — 이 저장소에서 가장 자주 나온 결함이다.
 */
describe("집계는 한 곳", () => {
  const src = readFileSync(fileURLToPath(new URL("./handlers.ts", import.meta.url)), "utf-8");

  it("앱과 같은 UsageAnalyzer 를 쓴다", () => {
    expect(src).toMatch(/from "\$lib\/usageAnalyzer"/);
    expect(src).toMatch(/new UsageAnalyzer\(\)/);
  });

  /** ⚠️ 경로 지식도 한 곳이다 — 두 곳에 적으면 CLI 가 앱과 다른 폴더를 본다. */
  it("로그 폴더를 mcp/cache 에서 가져온다", () => {
    expect(src).toMatch(/usageDirs/);
    expect(src, "CLI 가 경로를 자기 규칙으로 조립한다").not.toMatch(/com\.lapis\.dev/);
  });

  /** ⚠️ 확장자는 `.log` 다 — v3.7.1 에서 `.jsonl` 에서 바뀌었다. */
  it("`.log` 를 읽는다", () => {
    expect(src).toMatch(/\\\.log\$/);
  });
});

/**
 * `new` 는 **쓰기**다 — 3층(`replace` · `tag rename`)과 같은 규율을 따른다.
 */
describe("new", () => {
  const spec = COMMANDS.find((c) => c.name === "new")!;
  const src = readFileSync(fileURLToPath(new URL("./handlers.ts", import.meta.url)), "utf-8");

  it("이름이 필수다", () => {
    expect(spec.positional[0]?.required).toBe(true);
  });

  it("템플릿을 고를 수 있다", () => {
    expect(spec.options.map((o) => o.name)).toContain("template");
  });

  /** 🔴 덮어쓰면 되돌릴 방법이 없다. */
  it("이미 있으면 거부한다", () => {
    expect(src).toMatch(/existsSync\(target\)/);
    // ⚠️ 검사와 생성 사이의 틈은 파일시스템이 막는다.
    expect(src, "wx 플래그가 없으면 경쟁 상태가 남는다").toMatch(/flag: "wx"/);
  });

  /** 🔴 `../` 가 섞인 이름을 그대로 이으면 vault 밖을 쓴다. */
  it("vault 밖을 막는다", () => {
    expect(src).toMatch(/outside_vault/);
    // 문자열이 아니라 **해소한 경로**로 봐야 한다 — 문자열 비교는 `..` 를 놓친다.
    expect(src).toMatch(/nodePath\.resolve\(vc\.root\)/);
  });

  /** ⚠️ 템플릿 채우기는 앱과 **같은 함수**여야 한다 — 아니면 두 문서가 달라진다. */
  it("앱과 같은 템플릿 함수를 쓴다", () => {
    expect(src).toMatch(/from "\$lib\/noteTemplate"/);
    expect(src).toMatch(/applyTemplate\(/);
  });
});

describe("completion", () => {
  const src = readFileSync(fileURLToPath(new URL("./handlers.ts", import.meta.url)), "utf-8");

  /**
   * 🔴 **명령 목록을 손으로 안 적는다.** 적으면 명령을 추가할 때마다 잊고, 잊으면
   * 새 명령만 완성이 안 된다 — 에러는 안 난다.
   */
  it("명령 목록을 spec 에서 뽑는다", () => {
    expect(src).toMatch(/COMMANDS\.map\(\(c\) => c\.name\)/);
  });

  it("셸 셋을 안다", () => {
    expect(src).toMatch(/"bash"/);
    expect(src).toMatch(/"zsh"/);
    expect(src).toMatch(/"pwsh"/);
  });
});

/**
 * `config` — 앱 설정을 CLI 에서 본다.
 *
 * ## 🔴 왜 필요했나
 *
 * `mcp_enabled` 를 켜는 경로가 **앱 하나**뿐이었다. 그 토글이 안 먹었을 때 확인할
 * 다른 눈이 없어서 원인을 엉뚱한 곳(MCP 서버)에서 찾았다. 읽는 경로가 둘이면
 * **어긋난 순간 바로 보인다.**
 */
describe("config", () => {
  const spec = COMMANDS.find((c) => c.name === "config")!;
  const src = readFileSync(fileURLToPath(new URL("./handlers.ts", import.meta.url)), "utf-8");

  /** 인자 없이도 돌아야 한다 — 전부 보기가 가장 흔한 쓰임이다. */
  it("키도 값도 선택이다", () => {
    expect(spec.positional[0]?.required).toBe(false);
    expect(spec.positional[1]?.required).toBe(false);
  });

  /**
   * 🔴 **경로 지식을 여기서 다시 만들지 않는다.** `mcp/cache.ts` 가 후보 파일을 안다 —
   * dev 와 릴리스가 갈려 있어서, CLI 가 자기 규칙으로 조립하면 한쪽만 보게 된다.
   */
  it("설정 읽기·쓰기를 mcp/cache 에 맡긴다", () => {
    expect(src).toMatch(/readSettings/);
    expect(src).toMatch(/writeSetting/);
  });

  /**
   * 🔴 **설정 파일 하나에 앱 설정 전부가 들어 있다.**
   *
   * 직접 덮다 중간에 끊기면 키 하나가 아니라 전부 날아가고, 앱은 그걸 "설정이 없다"로
   * 읽는다 — MCP 게이트가 닫히고, 원인이 CLI 한 줄이었다는 걸 아무도 못 찾는다.
   * `vault.rs` 의 쓰기 불변식이 여기에도 그대로 필요하다.
   */
  it("쓰기가 원자적이다", () => {
    const cache = readFileSync(fileURLToPath(new URL("../mcp/cache.ts", import.meta.url)), "utf-8");
    expect(cache).toMatch(/renameSync\(tmp, file\)/);
    // ⚠️ 설정 파일에 직접 쓰는 곳이 하나라도 남으면 그 경로만 위험한 채로 남는다.
    expect(cache, "설정 파일을 직접 덮어쓴다").not.toMatch(/writeFileSync\(file,/);
  });

  /** `--quiet` 면 값만 — 스크립트가 `$(lapis config x --quiet)` 로 받아쓰는 자리다. */
  it("quiet 면 값만 낸다", () => {
    expect(src).toMatch(/p\.options\.quiet === true \? String\(v \?\? ""\)/);
  });

  /** ⚠️ 앱이 떠 있으면 메모리 값이 이긴다 — 안 적으면 "썼는데 안 먹는다"가 된다. */
  it("다시 켜야 한다고 적는다", () => {
    expect(src).toMatch(/앱이 떠 있으면 다시 켜야 반영된다/);
  });
});

/**
 * `diff` — 노트의 git 변경.
 */
describe("diff", () => {
  const spec = COMMANDS.find((c) => c.name === "diff")!;
  const src = readFileSync(fileURLToPath(new URL("./handlers.ts", import.meta.url)), "utf-8");

  it("리비전을 고를 수 있다", () => {
    expect(spec.options.map((o) => o.name)).toContain("rev");
  });

  /**
   * 🔴 **변경 없음은 오류가 아니다.** 0 이 아닌 코드로 끝내면 `&&` 로 이은 스크립트가
   * 거기서 멈춘다 — 아무 문제도 없는데.
   */
  it("변경이 없어도 0 으로 끝낸다", () => {
    const at = src.indexOf("// ⚠️ 변경이 없는 것은 **오류가 아니다.**");
    expect(at).toBeGreaterThan(-1);
    // 그 자리에서 `fail` 을 부르지 않는지 — 다음 5줄 안을 본다.
    expect(src.slice(at, at + 240)).not.toMatch(/out\.fail/);
  });

  /** ⚠️ git 이 없는 것과 저장소가 아닌 것은 다른 실패다. 조치가 다르다. */
  it("git 없음과 저장소 아님을 가른다", () => {
    expect(src).toMatch(/git 이 PATH 에 있는지 볼 것/);
    expect(src).toMatch(/vault 가 git 저장소인지 볼 것/);
  });
});

/**
 * 🔴 **`-` 는 표준입력이다.**
 *
 * 이게 있어야 `lapis search --json | jq -r .results[0].path | lapis read -` 가 된다.
 * 없으면 명령마다 셸 변수를 거쳐야 하고, CLI 가 파이프에 못 낀다.
 */
describe("표준입력", () => {
  const src = readFileSync(fileURLToPath(new URL("./handlers.ts", import.meta.url)), "utf-8");

  it("`-` 를 표준입력으로 읽는다", () => {
    expect(src).toMatch(/p\.positional\[0\] === "-" \? readStdinLine\(\)/);
  });

  /**
   * ⚠️ **CRLF 를 잘라야 한다.** Windows 파이프는 `\r\n` 을 준다. `\n` 만 자르면
   * 경로 끝에 `\r` 이 붙고, 파일은 **없다고** 나온다 — 눈으로는 멀쩡해 보이는 채로.
   */
  it("CRLF 를 자른다", () => {
    expect(src).toContain(String.raw`raw.split(/\r?\n/)`);
  });

  /** ⚠️ 빈 줄을 집으면 "노트를 못 찾음"이 된다 — 원인이 파이프인 걸 못 알아챈다. */
  it("빈 줄을 건너뛴다", () => {
    expect(src).toMatch(/\.find\(\(l\) => l\.trim\(\) !== ""\)/);
  });
});

/**
 * `--quiet` 는 **전역**이다 — 명령마다 따로 두면 어떤 것엔 있고 어떤 것엔 없다.
 */
describe("--quiet", () => {
  it("전역 옵션이다", () => {
    expect(GLOBAL_OPTIONS.map((o) => o.name)).toContain("quiet");
  });

  /** ⚠️ 명령이 자기 `quiet` 를 또 선언하면 파서가 어느 쪽을 볼지가 파일 순서에 달린다. */
  it("명령이 따로 선언하지 않는다", () => {
    const dupes = COMMANDS.filter((c) => c.options.some((o) => o.name === "quiet"));
    expect(dupes.map((c) => c.name)).toEqual([]);
  });

  /** 🔴 `--json` 과 겹치면 안 된다 — JSON 은 애초에 안내 줄이 없다. */
  it("json 과 별개다", () => {
    expect(GLOBAL_OPTIONS.map((o) => o.name)).toContain("json");
  });
});
