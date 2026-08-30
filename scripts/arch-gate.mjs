#!/usr/bin/env node
/**
 * 아키텍처 게이트 — 층 경계와 **규칙의 주인**을 grep 으로 강제한다.
 *
 * ```
 * core   질의 핵 · 캐시 · 앱 코드 파사드          → $lib 만
 * ops    앱 조작(띄우기·렌더·인덱스·내보내기)     → core · $lib
 * cli    사람과 스크립트가 쓰는 표면              → ops · core · $lib
 * mcp    LLM 이 쓰는 표면                         → ops · core · $lib
 * ```
 *
 * 🔴 **왜 코드로 옮겼나.** 규칙이 문서에만 있으면 반드시 새어 나간다. 두 번 겪었다:
 *
 * - 헤드리스가 순수 함수 하나 쓰려고 Svelte 스토어를 통째로 물었고, 그 때문에 6차에서
 *   `lapis_usage` 가 "안 쓴 명령 없음"이라고 **거짓말했다.**
 * - `notePath.ts` 는 주석으로 *"확장자를 벗기는 곳은 여기 하나다"* 라고 **적어 뒀는데**,
 *   그 사이에 여덟 곳이 자기 정규식을 갖게 됐고 그중 셋이 틀렸다 —
 *   `.mmd` 노트의 이름을 바꾸면 링크가 조용히 끊겼다.
 *
 * 근거와 측정치는 `docs/reference/lapis-module-boundaries-20260830.md`.
 *
 * ⚠️ **경로 구분자를 항상 `/` 로 만든다.** Windows 에서 `path.relative` 는
 * `cli\\handlers.ts` 를 주는데 아래 규칙은 `"cli/"` 로 비교한다 — 안 맞추면 검사가
 * **한 번도 안 돈 채 초록**이 된다. slate 가 정확히 이걸로 당했다.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const AREAS = ["src", "core", "ops", "cli", "mcp"];

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

/** 그 specifier 가 어느 층을 가리키나. 상대경로와 별칭 둘 다 본다. */
const points = (s, area) => s.includes("../" + area + "/") || s.startsWith(area + "/");

const HEADLESS = /^(core|ops|cli|mcp)\//;

/**
 * 층 규칙 — `when` 인 파일에서 `forbid` 인 import 를 찾으면 실패한다.
 *
 * ⚠️ 테스트 파일은 뺀다 — 테스트는 어느 층이든 들여다볼 수 있어야 한다. 대신
 * **프로덕션 코드만** 본다는 뜻이므로 규칙이 헐거워지지 않는다.
 */
const IMPORT_RULES = [
  {
    id: "headless-no-svelte",
    why: "헤드리스(core·ops·cli·mcp)는 앱 없이 돈다. Svelte 를 물면 순수 함수 하나 때문에 프레임워크가 딸려 온다.",
    when: (f) => HEADLESS.test(f),
    forbid: (s) => s === "svelte" || s.startsWith("svelte/"),
  },
  {
    id: "headless-no-stores",
    why: "`$lib/stores/*` 는 Svelte 스토어다. 순수 함수가 거기 얹혀 있으면 그 함수를 순수 모듈로 떼어 낸다.",
    when: (f) => HEADLESS.test(f),
    forbid: (s) => s.startsWith("$lib/stores/") || s.includes("/lib/stores/"),
  },
  {
    id: "core-is-bottom",
    why: "`core/` 는 가장 아래다. 위층을 부르면 층이 뒤집히고, 그러면 누가 누구의 주인인지 사라진다.",
    when: (f) => /^core\//.test(f),
    forbid: (s) => points(s, "ops") || points(s, "cli") || points(s, "mcp"),
  },
  {
    id: "ops-below-surfaces",
    why: "`ops/` 는 표면 아래다. cli·mcp 를 부르면 두 표면이 서로를 통해 얽힌다.",
    when: (f) => /^ops\//.test(f),
    forbid: (s) => points(s, "cli") || points(s, "mcp"),
  },
  {
    id: "surfaces-do-not-cross",
    why:
      "cli 와 mcp 는 **나란한 표면**이다. 서로를 부르면 순환이 되고, 그러면 공용이어야 할 층이 " +
      "한쪽 지붕 밑에 갇힌다. 공용은 `core/` 나 `ops/` 로 내린다.",
    when: (f) => /^(cli|mcp)\//.test(f),
    forbid: (s, f) => (/^cli\//.test(f) ? points(s, "mcp") : points(s, "cli")),
  },
];

/**
 * 내용 규칙 — 어떤 규칙이 **한 파일에만** 있어야 할 때.
 *
 * 🔴 여기 첫 손님이 노트 확장자다. `notePath.ts` 주석이 "여기 하나"라고 적어 뒀지만
 * 주석은 규칙을 못 지킨다 — 여덟 곳이 자기 정규식을 갖고 있었고 그중 셋이 틀렸다:
 *
 * - `lapis new diagram.mmd` → `diagram.mmd.md`
 * - `.mmd` 노트 이름을 바꾸면 마크다운 링크가 **조용히 끊겼다**
 * - `.mmd` 링크가 해소되지 않았다
 *
 * ⚠️ 넷은 인덱서가 만들지도 않는 `markdown` 까지 벗기고 있었다 — 생산자·소비자 비대칭.
 */
const CONTENT_RULES = [
  {
    id: "note-ext-single-owner",
    why:
      "노트 확장자 규칙은 `src/lib/notePath.ts` 하나에만 둔다. " +
      "`noteStem` · `stripNoteExt` · `withNoteExt` · `hasNoteExt` · `noteExtOf` 를 쓴다.",
    when: (f) => f !== "src/lib/notePath.ts",
    // 정규식 리터럴 안의 확장자 패턴. 문자열 `".md"` 는 안 본다 —
    // 템플릿 파일 이름처럼 노트 확장자가 아닌 `.md` 도 있다.
    patterns: [String.raw`\.md$`, String.raw`\.mmd$`, String.raw`\.(md|mmd)`, String.raw`\.m?md`],
  },
];

const violations = [];
for (const f of files) {
  const r = rel(f);
  if (/\.test\.ts$/.test(r) || r.includes("/testHarness/")) continue;
  const src = readFileSync(f, "utf8");

  const specs = specifiers(src);
  for (const rule of IMPORT_RULES) {
    if (!rule.when(r)) continue;
    for (const s of specs) {
      if (rule.forbid(s, r)) violations.push({ rule: rule.id, why: rule.why, file: r, spec: s });
    }
  }

  for (const rule of CONTENT_RULES) {
    if (!rule.when(r)) continue;
    for (const p of rule.patterns) {
      if (src.includes(p)) violations.push({ rule: rule.id, why: rule.why, file: r, spec: p });
    }
  }
}

if (violations.length === 0) {
  const n = IMPORT_RULES.length + CONTENT_RULES.length;
  console.log(`아키텍처 게이트 통과 — ${files.length} 파일 · 규칙 ${n}개`);
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
