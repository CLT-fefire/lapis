import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COMMANDS } from "./spec.ts";
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
