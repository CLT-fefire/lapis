import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COMMANDS } from "./spec.ts";
import { HANDLERS } from "./handlers.ts";

/**
 * **인덱스가 낡았는데 조용히 답하는 명령이 없는지** 본다.
 *
 * ## 왜 이 가드가 있나
 *
 * 낡음 보고가 `cmdSearch` **하나에만** 있었다. 그래서 `links --orphans`와 `tag audit`이
 * 낡은 인덱스로 **자신 있게 틀린 숫자**를 냈고, 실제로 그것 때문에 "vault가 깨끗하다"는
 * 잘못된 결론이 나온 적이 있다. 인덱싱 후 다시 돌리니 답이 달랐다 — 답이 바뀐 게 아니라
 * **처음 답이 틀렸던 것**이다.
 *
 * 이게 조용한 이유: 명령 하나하나는 멀쩡히 동작한다. 어긋난 것은 **명령들 사이의 일관성**
 * 이라, 어느 한 명령을 봐서는 안 보인다. 새 질의 명령을 추가하면서 이 한 줄을 빼먹는
 * 것도 아무 에러를 안 낸다.
 *
 * ⚠️ 문자열이 아니라 **호출**을 본다. 사람에게 보이는 문구는 바뀔 수 있지만 "낡음을
 * 다루는 코드가 있는가"는 그대로여야 한다.
 */

const SRC = readFileSync(fileURLToPath(new URL("./handlers.ts", import.meta.url)), "utf-8");

/** 한 핸들러 함수의 본문만 잘라낸다. 다음 최상위 `function`/`export function` 앞까지. */
function bodyOf(name: string): string {
  const re = new RegExp(`(?:export )?(?:async )?function ${name}\\(`);
  const m = re.exec(SRC);
  if (!m) return "";
  const from = m.index;
  const rest = SRC.slice(from + m[0].length);
  const next = /\n(?:export )?(?:async )?function \w+\(|\nexport const /.exec(rest);
  return rest.slice(0, next ? next.index : rest.length);
}

/**
 * 인덱스를 읽어 **답을 내는** 명령 → 핸들러 이름.
 *
 * 여기 없는 명령과 그 이유:
 * - `status` — 낡음 자체가 출력이다(`checkStale`을 직접 낸다)
 * - `index` — 낡음을 **없애는** 쪽이다
 * - `open` — 노트 하나를 앱에 넘길 뿐 인덱스 내용을 답으로 내지 않는다
 */
const INDEX_READING: Record<string, string> = {
  search: "cmdSearch",
  backlinks: "cmdBacklinks",
  list: "cmdList",
  links: "cmdLinks",
  tag: "cmdTagAudit",
  replace: "cmdReplace",
  doctor: "cmdDoctor",
};

/** 되돌릴 수 없는 쓰기를 하는 명령 — 낡으면 **막아야** 한다. */
const WRITERS = ["tag", "replace"] as const;

describe("낡음 보고", () => {
  /** ⚠️ 카나리아 — 본문을 못 잘라내면 아래 단언이 빈 문자열을 보고 통과한다. */
  it("핸들러 본문을 실제로 잘라냈다", () => {
    for (const fn of Object.values(INDEX_READING)) {
      expect(bodyOf(fn).length, `${fn} 본문`).toBeGreaterThan(100);
    }
  });

  /**
   * `lapisQuery`를 쓰는 명령은 `res.stale` 하나로 **양쪽이 다 된다** — JSON은 `res`를
   * 통째로 내보내므로 필드가 자동으로 실린다.
   */
  const VIA_QUERY = ["cmdSearch", "cmdBacklinks", "cmdList"];

  it.each(VIA_QUERY)("%s 가 res.stale 을 낸다", (fn) => {
    expect(/res\.stale/.test(bodyOf(fn)), `${fn}`).toBe(true);
  });

  /**
   * ⚠️ **JSON과 사람용을 따로 본다.**
   *
   * 처음엔 넷 중 하나라도 있으면 통과시켰는데, 카나리아를 돌려 보니 **사람용 한 줄을
   * 지워도 통과했다** — JSON 쪽 `staleField`가 남아 있었기 때문이다.
   *
   * 그게 정확히 가장 나쁜 모양이다. 스크립트는 `stale` 필드를 받는데 터미널 앞의 사람은
   * 아무 경고 없이 낡은 숫자를 본다. **가드가 잡아야 할 것을 못 잡고 있었다.**
   */
  const VIA_VAULT = ["cmdLinks", "cmdTagAudit", "cmdReplace", "cmdDoctor"];

  it.each(VIA_VAULT)("%s 의 --json 출력에 낡음이 실린다", (fn) => {
    const body = bodyOf(fn);
    expect(/staleField\(|stale: st\b/.test(body), `${fn} JSON`).toBe(true);
  });

  it.each(VIA_VAULT)("%s 의 사람용 출력에도 낡음이 나온다", (fn) => {
    const body = bodyOf(fn);
    expect(/reportStale\(|STALE_LINE/.test(body), `${fn} 사람용`).toBe(true);
  });

  it("모든 인덱스 읽기 명령이 spec에 실제로 있다", () => {
    const names = COMMANDS.map((c) => c.name);
    for (const cmd of Object.keys(INDEX_READING)) {
      expect(names, `spec에 ${cmd}`).toContain(cmd);
      expect(HANDLERS[cmd], `핸들러 ${cmd}`).toBeTypeOf("function");
    }
  });
});

describe("쓰기는 낡으면 막는다", () => {
  it.each(WRITERS)("`lapis %s` 가 requireFreshIndex를 부른다", (cmd) => {
    const fn = cmd === "tag" ? "cmdTag" : "cmdReplace";
    expect(/requireFreshIndex\(/.test(bodyOf(fn)), `${fn}`).toBe(true);
  });

  it.each(WRITERS)("`lapis %s` 에 --allow-stale 탈출구가 있다", (cmd) => {
    const spec = COMMANDS.find((c) => c.name === cmd);
    expect(spec?.options.map((o) => o.name)).toContain("allow-stale");
  });

  /**
   * ⚠️ **읽기 명령에는 붙이면 안 된다.** 읽기는 애초에 막지 않으므로(보고만 한다)
   * 옵션이 있으면 **눌러도 아무 일이 없는 표면**이 하나 는다 — 이 저장소가 `--since`를
   * `links --broken`에 노출했다가 겪은 것과 같은 부류다.
   */
  it("읽기 전용 명령에는 --allow-stale이 없다", () => {
    const writers = new Set<string>(WRITERS);
    for (const c of COMMANDS) {
      if (writers.has(c.name)) continue;
      expect(
        c.options.map((o) => o.name),
        `${c.name}에 불필요한 --allow-stale`,
      ).not.toContain("allow-stale");
    }
  });
});

describe("doctor", () => {
  it("옵션 없이 도는 명령이다 — 인자를 요구하지 않는다", () => {
    const spec = COMMANDS.find((c) => c.name === "doctor");
    expect(spec).toBeDefined();
    expect(spec!.positional.filter((x) => x.required)).toHaveLength(0);
  });

  /**
   * "문제 있음"(1)과 "못 돌렸음"(2)을 가른다. 섞으면 CI에서 **vault 경로 오타가 위생
   * 문제로 보고된다.** 다른 명령은 1을 "문제 있음"으로 안 쓰므로 이 구분이 필요 없다.
   */
  it("종료 코드 둘을 실제로 구분해 쓴다", () => {
    const body = bodyOf("cmdDoctor");
    expect(body).toMatch(/process\.exitCode = 1/);
    // vault 해소 실패는 2로 다시 낸다 (한 줄이든 여러 줄이든 마지막 인자가 2다).
    expect(body).toMatch(/out\.fail\([^;]*?\b2\s*[,)]/);
  });

  /**
   * ⚠️ `main.ts`가 마지막에 `process.exit()`을 부른다. 거기서 `exitCode`를 무시하면
   * doctor의 신호가 **조용히 사라진다** — 훅과 CI에서는 종료 코드가 유일한 신호다.
   * 실제로 처음 구현이 그랬고, 손으로 돌려보고서야 알았다.
   */
  it("main이 핸들러가 세운 exitCode를 존중한다", () => {
    const main = readFileSync(fileURLToPath(new URL("./main.ts", import.meta.url)), "utf-8");
    expect(main).toMatch(/process\.exit\(\s*typeof process\.exitCode === "number"/);
  });
});
