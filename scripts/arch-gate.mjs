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
  {
    id: "doc-status-single-owner",
    why:
      "`status` 의 낱말 표는 `src/lib/docStatus.ts` 하나에만 둔다. " +
      "끝난 것을 물으려면 갈래(`@done`)를 쓴다 — 낱말을 손으로 나열하지 않는다.",
    /**
     * ⚠️ 픽스처는 뺀다. 저기 있는 낱말은 **규칙이 아니라 노트 내용**이고, 갈린 상태를
     * 담고 있어야 감사 테스트가 무언가를 증명한다 — 통일하면 그 화면이 다시 빈다.
     */
    when: (f) =>
      f !== "src/lib/docStatus.ts" &&
      f !== "core/fixture.ts" &&
      f !== "src/lib/dev/fixtureVault.ts",
    /**
     * 🔴 **낱낱이 아니라 나열을 잡는다.** `완료` 한 낱말은 픽스처 노트 본문에도, UI 문구에도
     * 정당하게 나온다. 문제는 **여러 낱말을 한 파일에 늘어놓는 것**이다 — 그게 표를 베낀
     * 자리이고, 베낀 표는 반드시 낡는다. 실제로 둘이 그랬고 **둘 다 다섯 중 둘만** 적고
     * 있었다(`core/query.ts` · `cli/handlers.ts`). 그렇게 물으면 53건 중 15건만 잡혔다.
     */
    patterns: ["완료", "반영됨", "해결됨", "닫힘", "이전됨"],
    atLeast: 2,
  },
  {
    id: "code-block-single-owner",
    why:
      "「어느 줄이 코드인가」는 `src/lib/codeLines.ts` 하나에만 둔다. " +
      "`codeBlockLines` · `blankCodeBlocks` 를 쓴다.",
    /**
     * 🔴 맞는 답이 있는데도 **비공개라서** 사본이 자랐다. `linkRewrite.ts` 는 markdown-it
     * 블록 파스로 정확히 잡으면서 주석에 그 이유까지 적어 뒀는데, 그 함수가 export 가
     * 아니었다. 그래서 둘이 각자 naive 사본을 갖게 됐고 **셋이 서로 다른 답**을 냈다:
     *
     * - `openTasks` — 줄 토글. 들여쓴 코드블록 안의 `- [ ]` 를 할 일로 셌다
     * - `maskNonProse` — 정규식. `~~~` 와 들여쓴 코드 안의 낱말을 언급으로 보고했다
     *
     * ⚠️ 정규식으로는 못 고친다. 중첩 할 일도 네 칸 들여쓰기라 "네 칸이면 코드"로 두면
     * `depth` 가 죽는다. 리스트 계속인지 코드인지는 **블록 파서만** 안다.
     */
    when: (f) => f !== "src/lib/codeLines.ts",
    // markdown-it 사본(`code_block` 토큰)과 naive 정규식 사본(펜스 반복) 둘 다 잡는다.
    // ⚠️ 백틱은 String.raw 안에 못 넣는다(템플릿 종결자다). 코드 포인트로 적는다 —
    //    역슬래시를 섞으면 **실제 정규식과 안 맞아 가드가 반쪽이 된다.** 실제로 그랬다.
    patterns: ["code_block", "`{3,}", "~{3,}"],
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
    const hit = rule.patterns.filter((p) => src.includes(p));
    // ⚠️ `atLeast` 가 있으면 **나열**을 잡는 규칙이다 — 하나만 나온 것은 정당한 쓰임이다.
    if (rule.atLeast) {
      if (hit.length >= rule.atLeast) {
        violations.push({ rule: rule.id, why: rule.why, file: r, spec: hit.join(" · ") });
      }
      continue;
    }
    for (const p of hit) violations.push({ rule: rule.id, why: rule.why, file: r, spec: p });
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
