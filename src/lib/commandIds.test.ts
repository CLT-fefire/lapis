import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COMMAND_IDS } from "./commandIds";
import { HYGIENE_TABS, hygieneCommandId } from "./hygieneTabs";
import { UsageAnalyzer } from "./usageAnalyzer";
import { serialize } from "./usageSchema";

const CMD = (t: number, id: string): string =>
  serialize({ k: "cmd", t, id, via: "palette" });

/**
 * 🔴 **"안 쓴 명령 없음"과 "모른다"는 다른 말이다.**
 *
 * ## 실측한 거짓말
 *
 * 실제 MCP 클라이언트로 `lapis_usage` 를 불렀더니 이렇게 왔다:
 *
 * ```
 * "commands": [], "unusedCommands": []
 * ```
 *
 * 명령이 **0건** 쓰였는데 "안 쓴 명령이 없다"고 답했다. 진실은 "분모를 모른다"였다 —
 * `mcp/tools.ts` 와 `cli/handlers.ts` 가 `new UsageAnalyzer()` 를 인자 없이 불러
 * `knownCommands` 가 비어 있었다. 앱(`usageAutoReport.ts`)만 넘기고 있었다.
 *
 * ⚠️ 분석기 테스트는 **항상 `knownCommands` 를 넘겨서** 실제 소비자가 쓰는 경로를
 * 한 번도 안 밟았다. 잘 덮인 모듈 옆에서 배선이 비어 있었다.
 *
 * ## 두 갈래로 막는다
 *
 * 1. **분모를 못 읽던 이유를 없앤다** — 명령 목록이 `commands.ts` 에 있었고 그 파일은
 *    Svelte 스토어·paraglide 를 물어 Node 에서 못 읽는다. id 만 순수 모듈로 뗀다.
 * 2. **없으면 없다고 말한다** — 분모가 없으면 `null` 이다. `[]` 는 "다 썼다"로 읽힌다.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");

describe("순수 모듈이다", () => {
  /**
   * 🔴 **import 가 하나도 없어야 한다.** 하나라도 생기면 그 파일이 앱 트리를 끌고 오고,
   * Node 소비자(CLI · MCP)가 다시 못 읽게 된다 — 이 결함이 났던 바로 그 이유다.
   */
  it("commandIds.ts 는 아무것도 import 하지 않는다", () => {
    const src = read("./commandIds.ts");
    expect(src, "import 가 생겼다 — Node 소비자가 못 읽게 된다").not.toMatch(/^\s*import\s/m);
  });

  it("id 가 비어 있지 않다", () => {
    expect(COMMAND_IDS.length).toBeGreaterThan(10);
    expect(new Set(COMMAND_IDS).size, "겹치는 id 가 있다").toBe(COMMAND_IDS.length);
  });
});

/**
 * 🔴 **두 벌이 되면 갈린다.**
 *
 * 목록을 떼어낸 대가로 "실제 명령"과 "id 목록"이 둘이 됐다. 어긋나면 `unusedCommands`
 * 가 **있지도 않은 명령을 안 썼다고** 하거나, 새 명령을 아예 안 센다.
 *
 * ⚠️ 한쪽 방향은 타입이 막는다(`Command["id"]` 가 `CommandId` 유니온이라 목록에 없는
 * id 는 컴파일이 안 된다). 반대 방향 — 목록에만 있고 안 만든 것 — 은 여기서 막는다.
 */
describe("실제 명령과 목록이 같다", () => {
  it("빠짐도 남음도 없다", async () => {
    // ⚠️ `commands.ts` 는 Svelte 스토어를 물어 **node 프로젝트에서 못 읽는다.**
    //    그래서 소스를 읽어 id 를 뽑는다 — 이 검사 하나 때문에 dom 프로젝트로
    //    옮기면 나머지 순수 검사까지 브라우저 해석을 타게 된다.
    const src = read("./commands.ts");
    const stat = [...src.matchAll(/^\s*id: "([a-z0-9.-]+)",$/gm)].map((m) => m[1]);
    // 진단 탭 명령은 **목록에서 만든다**(`HYGIENE_TABS`). 소스에 리터럴 id 가 없으므로
    // 생성이 실제로 거기 있는지 확인하고, 펼치는 것은 **주인 목록**으로 한다.
    //
    // ⚠️ 여기서 탭 이름을 손으로 다시 적으면 이 파일이 네 번째 사본이 된다.
    const gen = /HYGIENE_TABS\.filter\(\((\w+)\) => \1 !== "(\w+)"\)\.map\(/.exec(src);
    const dyn = gen ? HYGIENE_TABS.filter((t) => t !== gen[2]).map(hygieneCommandId) : [];
    const built = [...stat, ...dyn].sort();
    expect(built.length, "명령을 하나도 못 뽑았다 — 정규식이 코드와 어긋났다").toBeGreaterThan(10);
    // ⚠️ 생성 쪽도 따로 본다. 위 숫자는 정적 id 만으로도 넘어서 **생성이 통째로 빠져도
    //    조용히 통과**할 수 있다 — 실제로 생성 방식을 바꿨을 때 그럴 뻔했다.
    expect(dyn.length, "진단 탭 명령을 하나도 못 뽑았다 — 생성 코드와 어긋났다").toBeGreaterThan(5);
    expect(built).toEqual([...COMMAND_IDS].sort());
  });
});

/**
 * 🔴 분모가 없으면 **`null`** 이다.
 */
describe("모르면 모른다고 한다", () => {
  it("knownCommands 를 안 주면 null", () => {
    const a = new UsageAnalyzer();
    a.feed(CMD(1, "new-note"));
    expect(a.result().unusedCommands, '"다 썼다"로 읽히는 빈 배열').toBeNull();
  });

  it("주면 안 쓴 것을 센다", () => {
    const a = new UsageAnalyzer({ knownCommands: ["new-note", "open-vault"] });
    a.feed(CMD(1, "new-note"));
    expect(a.result().unusedCommands).toEqual(["open-vault"]);
  });

  /** 아무것도 안 썼으면 **전부** 안 쓴 것이다 — 이때 `[]` 가 나오면 그게 거짓말이다. */
  it("하나도 안 썼으면 전부 안 쓴 것", () => {
    const a = new UsageAnalyzer({ knownCommands: ["a", "b"] });
    // 명령이 아닌 이벤트 하나 — 로그는 있는데 명령은 0건인 상태.
    a.feed(JSON.stringify({ k: "session", t: 1, ev: "start", v: "3.10.0", os: "windows" }));
    expect(a.result().unusedCommands).toEqual(["a", "b"]);
  });
});

/**
 * ⚠️ 배선 — 소비자 셋이 **다** 넘겨야 한다. 하나만 빠져도 그 도구만 조용히 틀린다.
 */
describe("소비자가 분모를 넘긴다", () => {
  for (const [label, rel] of [
    ["앱 자동 리포트", "./usageAutoReport.ts"],
    ["CLI", "../../cli/handlers.ts"],
    ["MCP", "../../mcp/tools.ts"],
  ] as const) {
    it(`${label} 가 knownCommands 를 넘긴다`, () => {
      const src = read(rel);
      expect(src, `${label} 가 분모 없이 분석기를 만든다`).not.toMatch(
        /new UsageAnalyzer\(\s*\)/,
      );
      expect(src).toMatch(/knownCommands/);
    });
  }
});
