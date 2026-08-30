import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { COMMANDS } from "./spec.ts";
import { HANDLERS, type Out } from "./handlers.ts";
import type { ParsedCommand } from "./args.ts";

/**
 * `lapis usage` 의 **사람용 요약이 자기가 계산한 것을 말하는가.**
 *
 * ## 🔴 왜 (2026-08-30)
 *
 * `usageAnalyzer` 는 다 계산하는데 `cmdUsage` 가 안 찍는 것이 셋이었다:
 *
 * | JSON | 실제 값 | 사람용에 |
 * |---|---|---|
 * | `errors[]` | `[reindex] scan/update 실패` **43회** 외 둘 | 없음 — "경고 50" 이라는 맨숫자뿐 |
 * | `opens[]` · `openVia` | **31회 / 8노트** | 없음 |
 * | `unusedCommands` | **21개** | 없음 |
 *
 * ⚠️ **이게 나를 속였다.** "많이 쓴 명령: open:note 3" 을 읽고 *"GUI 를 거의 안 쓴다"* 고
 * 결론냈는데 실제 열기는 31회였다. `commands` 는 팔레트발 명령만 센다.
 *
 * 이 저장소가 이미 아는 부류다 — `taskConcentration` 주석: *"맨숫자 하나는 어디에 몰렸는지를
 * 감춘다."* **"경고 50" 이 정확히 그거다.** 43이 한 실패에 몰려 있는데 이름이 안 나온다.
 *
 * ⚠️ 계산이 맞아도 **안 보이면 같은 결과**다. `unusedCommands` 는 예전에 늘 빈 배열이라
 * 거짓말한 적이 있고(6차), 고쳐 놨더니 이번엔 화면이 안 보여줬다.
 */

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** 실제 로그와 같은 모양의 줄들. */
function makeLog(): string {
  const lines: string[] = [];
  let t = 1_788_000_000_000;
  lines.push(JSON.stringify({ k: "session", t: t++ }));
  // 한 실패에 몰린 경고 — 이름이 안 나오면 "경고 5" 로만 보인다.
  for (let i = 0; i < 5; i++) {
    lines.push(
      JSON.stringify({ k: "err", t: t++, at: "stores/vault", msg: "warn: [테스트] 몰린 실패" }),
    );
  }
  lines.push(JSON.stringify({ k: "err", t: t++, at: "stores/other", msg: "warn: [테스트] 한 번" }));
  // 팔레트발 명령 1건 — 사람용이 지금 이것만 보여준다.
  lines.push(JSON.stringify({ k: "cmd", t: t++, id: "open:note", via: "palette" }));
  // 실제 열기는 훨씬 많다.
  for (let i = 0; i < 4; i++) {
    lines.push(JSON.stringify({ k: "open", t: t++, path: "/v/자주-여는-노트.md", via: "tab" }));
  }
  lines.push(JSON.stringify({ k: "open", t: t++, path: "/v/가끔.md", via: "cli" }));
  return lines.join("\n") + "\n";
}

function run(json: boolean): { lines: string[]; value: unknown } {
  const dir = mkdtempSync(nodePath.join(tmpdir(), "lapis-usage-"));
  dirs.push(dir);
  writeFileSync(nodePath.join(dir, "2026-08.log"), makeLog(), "utf-8");

  const lines: string[] = [];
  let value: unknown;
  const out: Out = {
    json,
    line: (t) => lines.push(t),
    json_: (v) => {
      value = v;
    },
    fail: (kind, message) => {
      throw new Error(`${kind}: ${message}`);
    },
  };
  const command = COMMANDS.find((c) => c.name === "usage")!;
  const p: ParsedCommand = { command, positional: [], options: { dir, json }, help: false };
  HANDLERS.usage(p, out);
  return { lines, value };
}

const human = () => run(false).lines.join("\n");
const json = () =>
  run(true).value as {
    errors: { at: string; msg: string; count: number }[];
    opens: { path: string; total: number }[];
    openVia: Record<string, number>;
    unusedCommands: string[] | null;
    warnCount: number;
  };

describe("사람용 요약이 JSON 과 같은 것을 말한다", () => {
  /** 가드가 빈 것을 보고 통과하지 않게. */
  it("픽스처가 실제로 셋을 만든다", () => {
    const r = json();
    expect(r.warnCount).toBe(6);
    expect(r.errors.length).toBeGreaterThan(1);
    expect(r.opens.length).toBe(2);
    expect(r.unusedCommands?.length ?? 0).toBeGreaterThan(0);
  });

  /** 🔴 43회가 "경고 50" 안에 이름 없이 묻혀 있던 자리. */
  it("몰린 경고를 이름과 횟수로 말한다", () => {
    const text = human();
    expect(text).toContain("[테스트] 몰린 실패");
    expect(text).toContain("stores/vault");
  });

  /** 🔴 "open:note 3" 만 보고 "GUI 를 거의 안 쓴다"고 읽게 만들던 자리. */
  it("실제로 연 노트와 경로별 횟수를 말한다", () => {
    const text = human();
    expect(text).toContain("자주-여는-노트");
    // 명령(1건)이 아니라 열기(5건)를 말해야 한다.
    expect(text).toMatch(/tab/);
  });

  it("한 번도 안 쓴 명령이 몇 개인지 말한다", () => {
    const r = json();
    const n = r.unusedCommands?.length ?? 0;
    expect(human()).toContain(String(n));
  });

  /** ⚠️ 자를 수는 있다. 다만 **잘랐다고 말해야** 한다 — 잘린 목록은 전부처럼 읽힌다. */
  it("목록을 자르면 잘랐다고 말한다", () => {
    const r = json();
    const text = human();
    const n = r.unusedCommands?.length ?? 0;
    if (n > 10) expect(text).toMatch(/외 \d+개|더 있다|\.\.\./);
  });
});
