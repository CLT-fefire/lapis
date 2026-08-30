#!/usr/bin/env node
/**
 * 아키텍처 게이트 — 층 경계를 grep 으로 강제한다.
 *
 * 🔴 **왜 코드로 옮겼나.** 규칙이 문서에만 있으면 반드시 새어 나간다. 실제로 샜다:
 * 헤드리스(cli·mcp)가 순수 함수 하나 쓰려고 Svelte 스토어 모듈을 통째로 물고 있었고,
 * 그 때문에 6차에서 `lapis_usage` 가 "안 쓴 명령 없음"이라고 **거짓말했다**.
 * 근거와 측정치는 `docs/reference/lapis-module-boundaries-20260830.md`.
 *
 * ⚠️ **경로 구분자를 항상 `/` 로 만든다.** Windows 에서 `path.relative` 는
 * `cli\\handlers.ts` 를 주는데 아래 규칙은 `"cli/"` 로 비교한다 — 안 맞추면 검사가
 * **한 번도 안 돈 채 초록**이 된다. slate 가 정확히 이걸로 당했다.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 층. 위에 있을수록 상위이고, 상위만 하위를 부를 수 있다. */
const AREAS = ["src", "cli", "mcp", "appctl"];

const files = [];
for (const a of AREAS) {
  const dir = path.join(ROOT, a);
  if (!existsSync(dir)) continue;
  (function walk(d) {
    for (const e of readdirSync(d)) {
      const p = path.join(d, e);
      if (statSync(p).isDirectory()) {
        if (e === "paraglide" || e === "node_modules") continue;
        walk(p);
      } else if (/\.(ts|svelte)$/.test(e)) files.push(p);
    }
  })(dir);
}

/** 🔴 항상 `/`. 위 주석 참조. */
const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");

/** import 되는 대상(specifier)만 뽑는다 — 주석 속 글자에 안 걸리게. */
function specifiers(src) {
  const out = [];
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) out.push(m[1]);
  return out;
}

/**
 * 규칙. `when` 이 참인 파일에서 `forbid` 가 참인 import 를 찾으면 실패한다.
 *
 * ⚠️ 테스트 파일은 뺀다 — 테스트는 어느 층이든 들여다볼 수 있어야 한다. 대신
 * **프로덕션 코드만** 본다는 뜻이므로 규칙이 헐거워지지 않는다.
 */
const RULES = [
  {
    id: "headless-no-svelte",
    why: "헤드리스(cli·mcp·appctl)는 앱 없이 돈다. Svelte 를 물면 순수 함수 하나 때문에 프레임워크가 딸려 온다.",
    when: (f) => /^(cli|mcp|appctl)\//.test(f),
    forbid: (s) => s === "svelte" || s.startsWith("svelte/"),
  },
  {
    id: "headless-no-stores",
    why: "`$lib/stores/*` 는 Svelte 스토어다. 순수 함수가 거기 얹혀 있으면 그 함수를 순수 모듈로 떼어 낸다.",
    when: (f) => /^(cli|mcp|appctl)\//.test(f),
    forbid: (s) => s.startsWith("$lib/stores/") || s.includes("/lib/stores/"),
  },
  {
    id: "cycle-debt-must-not-grow",
    why:
      "cli 와 mcp 가 서로를 문다. 지금 있는 것 말고 **새 간선을 더하지 않는다** — " +
      "아래 목록에 없는 mcp → cli import 는 실패한다.",
    when: (f) => /^mcp\//.test(f),
    forbid: (s, f) => {
      const isCli = s.includes("../cli/") || s.startsWith("cli/");
      if (!isCli) return false;
      return !CYCLE_DEBT.has(f + " → " + s);
    },
  },
];

/**
 * 🔴 **알려진 빚.** `cli` 와 `mcp` 는 서로를 문다 — cli 는 mcp 의 **질의 엔진**
 * (`lapisQuery` 등 1,012줄)을, mcp 는 cli 의 **연산 넷**(띄우기·렌더·인덱스·내보내기)을 쓴다.
 *
 * ⚠️ **작은 이동으로 못 끊는다.** 그 연산 넷은 바닥층이 아니라 상위 연산이라
 * `$lib` · `mcp/cache` · `cli/appLocate` 를 전부 문다. 제대로 끊으려면 `core`(원시값·캐시) ·
 * `ops`(연산) · 표면(cli·mcp) 셋으로 가르는 3,000줄짜리 기계적 이동이 필요하다.
 * 근거와 측정치는 `docs/reference/lapis-module-boundaries-20260830.md`.
 *
 * 그래서 지금은 **못 자라게만** 막는다. 여기 없는 간선이 생기면 게이트가 운다.
 * 빚을 갚으면 이 목록에서 지운다 — 목록이 비면 규칙을 진짜 금지로 바꾼다.
 */
const CYCLE_DEBT = new Set([
  "mcp/tools.ts → ../cli/appLaunch.ts",
  "mcp/tools.ts → ../cli/renderRequest.ts",
  "mcp/tools.ts → ../cli/indexRun.ts",
  "mcp/tools.ts → ../cli/exportRun.ts",
]);

const violations = [];
for (const f of files) {
  const r = rel(f);
  if (/\.test\.ts$/.test(r) || r.includes("/testHarness/")) continue;
  const specs = specifiers(readFileSync(f, "utf8"));
  for (const rule of RULES) {
    if (!rule.when(r)) continue;
    for (const s of specs) {
      if (rule.forbid(s, r)) violations.push({ rule: rule.id, why: rule.why, file: r, spec: s });
    }
  }
}

if (violations.length === 0) {
  console.log(`아키텍처 게이트 통과 — ${files.length} 파일 · 규칙 ${RULES.length}개`);
  process.exit(0);
}

const byRule = new Map();
for (const v of violations) {
  if (!byRule.has(v.rule)) byRule.set(v.rule, []);
  byRule.get(v.rule).push(v);
}
console.error(`아키텍처 게이트 실패 — ${violations.length}건\n`);
for (const [id, vs] of byRule) {
  console.error(`[${id}] ${vs[0].why}`);
  for (const v of vs) console.error(`   ${v.file}  →  ${v.spec}`);
  console.error("");
}
process.exit(1);
