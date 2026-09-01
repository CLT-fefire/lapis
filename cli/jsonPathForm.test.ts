import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupFixtures, makeFixture, type Fixture, type FixtureNote } from "../core/fixture.ts";
import { resetState } from "../core/query.ts";
import { COMMANDS } from "./spec.ts";
import { HANDLERS, type Out } from "./handlers.ts";
import type { ParsedCommand } from "./args.ts";

/**
 * **CLI 의 `--json` 은 vault 상대 경로를 낸다** — 표면 전부에서.
 *
 * ## 🔴 왜 이 가드가 있나 (2026-08-30)
 *
 * `lapis tasks audit --json` 만 **절대 경로**를 냈다. 나머지(`search`·`backlinks`·
 * `links --orphans`)는 전부 상대였고, `cli/README.md` 는 *"\`lapisQuery()\` 의 응답을
 * 그대로 낸다"* 고 적어 두었다.
 *
 * ⚠️ **조용하다.** 명령 하나만 보면 멀쩡하다. 어긋난 것은 **표면 사이의 일관성**이라,
 * 두 출력을 교집합하는 순간에야 드러난다 — 그때도 에러가 아니라 **0건**으로 나온다.
 * 실제로 이 감사를 설계하다 그 0건을 "부패한 노트가 없다"로 읽을 뻔했다.
 *
 * 원인은 사소하다: 핸들러가 `rel` 을 만들어 **거르기에만** 쓰고 출력엔 안 태웠다.
 * 그래서 한 명령을 고치는 대신 **모든 명령**을 훑는다 — 다음 감사가 같은 자리에서 샌다.
 *
 * ⚠️ `vault` 키는 예외다. 저건 노트 경로가 아니라 **어느 vault 인지**를 말하는
 * 메타데이터라 절대 경로가 맞다.
 */

const NOTES: FixtureNote[] = [
  {
    rel: "proj/plans/open-work.md",
    title: "미완이 남은 계획",
    doc_kind: "plan",
    topic: "graph",
    props: { status: ["완료"] },
    targets: ["closed-work"],
    body: ["할 것", "", "- [ ] 첫째", "- [ ] 둘째", "- [x] 셋째"].join("\n"),
  },
  {
    rel: "proj/plans/closed-work.md",
    title: "다 끝난 계획",
    doc_kind: "plan",
    topic: "graph",
    props: { status: ["반영됨"] },
    body: ["할 것", "", "- [x] 다 했다"].join("\n"),
  },
  {
    rel: "proj/reference/no-status.md",
    title: "status 가 없는 노트",
    doc_kind: "reference",
    topic: "ui",
    body: ["- [ ] 영원히 미체크인 점검표"].join("\n"),
  },
];

let fx: Fixture;

beforeEach(() => {
  fx = makeFixture(NOTES);
  process.env.LAPIS_CACHE_DIR = fx.cacheDir;
  resetState();
});

afterEach(() => {
  delete process.env.LAPIS_CACHE_DIR;
  resetState();
  cleanupFixtures();
});

/** 핸들러가 낸 JSON 을 붙잡는 `Out`. `main.ts` 와 달리 stdout 을 안 만진다. */
function capture(): { out: Out; value: () => unknown } {
  let captured: unknown;
  const out: Out = {
    json: true,
    line: () => {},
    json_: (v) => {
      captured = v;
    },
    fail: (kind, message) => {
      throw new Error(`${kind}: ${message}`);
    },
  };
  return { out, value: () => captured };
}

function parsed(name: string, positional: string[] = [], options = {}): ParsedCommand {
  const command = COMMANDS.find((c) => c.name === name);
  if (!command) throw new Error(`명세에 없는 명령: ${name}`);
  return { command, positional, options: { json: true, ...options }, help: false };
}

/**
 * 값 안에서 **vault 루트로 시작하는 문자열**을 전부 찾는다. `vault` 키 아래는 건너뛴다.
 *
 * ⚠️ 경로처럼 생긴 것을 추측하지 않는다 — 픽스처의 실제 루트로 시작하는지만 본다.
 * 추측하면 이 가드가 조용히 아무것도 안 잡는 쪽으로 썩는다.
 */
function absolutePathsIn(value: unknown, root: string, at = "$"): string[] {
  if (typeof value === "string") return value.startsWith(root) ? [`${at} = ${value}`] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => absolutePathsIn(v, root, `${at}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) =>
      k === "vault" ? [] : absolutePathsIn(v, root, `${at}.${k}`),
    );
  }
  return [];
}

/** `--json` 을 내는 질의 명령 전부. 새 명령을 넣으면 여기도 넣는다. */
const JSON_COMMANDS: { name: string; positional?: string[]; options?: object }[] = [
  { name: "search", options: { "doc-kind": "plan" } },
  { name: "backlinks", positional: ["closed-work"] },
  { name: "list", positional: ["doc-kinds"] },
  { name: "links", options: { orphans: true } },
  { name: "links", options: { broken: true } },
  { name: "tag", positional: ["audit"] },
  { name: "props", positional: ["audit"] },
  { name: "tasks", positional: ["audit"] },
  { name: "stats" },
  { name: "doctor" },
];

describe("CLI --json 경로 형태", () => {
  /**
   * ⚠️ 가드가 **실패할 수 있는지** 먼저 본다. 픽스처 루트가 안 잡히면 아래 단언들이
   * 전부 빈 배열끼리 비교하며 조용히 통과한다.
   */
  it("검사기 자체가 절대 경로를 잡는다", () => {
    const fake = { rows: [{ path: `${fx.vaultRoot}/a.md` }], vault: fx.vaultRoot };
    expect(absolutePathsIn(fake, fx.vaultRoot)).toHaveLength(1); // vault 키는 빠진다
  });

  for (const c of JSON_COMMANDS) {
    const label = [c.name, ...(c.positional ?? []), ...Object.keys(c.options ?? {})].join(" ");

    it(`${label} 이 상대 경로만 낸다`, async () => {
      const { out, value } = capture();
      await HANDLERS[c.name](parsed(c.name, c.positional, c.options), out);
      const leaked = absolutePathsIn(value(), fx.vaultRoot);
      expect(leaked, `절대 경로가 샜다:\n${leaked.join("\n")}`).toEqual([]);
    });
  }

  /** 빈 응답에 대고 통과했다고 말하지 않게. */
  it("tasks audit 이 실제로 미완을 찾았다 — 빈 응답으로 통과하지 않는다", async () => {
    const { out, value } = capture();
    await HANDLERS.tasks(parsed("tasks", ["audit"]), out);
    const res = value() as { total?: { open?: number } };
    expect(res.total?.open ?? 0).toBeGreaterThan(0);
  });
});
