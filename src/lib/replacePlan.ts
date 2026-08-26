import type { LinkRewritePreviewItem } from "$lib/linkRewrite";

/**
 * vault 전체 찾아 바꾸기의 **계획**. 순수 함수 — 파일을 읽거나 쓰지 않는다.
 *
 * ## 모양을 새로 만들지 않는다
 *
 * 결과가 `linkRewrite` · `tagRewrite`와 **같은 `LinkRewritePreviewItem`** 이다. 그래서
 * 적용은 기존 `$lib/safeWrite`(백업 → 순차 쓰기 → 실패 시 롤백)를 **그대로** 탄다.
 * 되돌릴 수 없는 쓰기의 규칙을 두 벌로 만들지 않는다.
 *
 * ## ⚠️ 찾기와 바꾸기가 **같은 엔진**이어야 한다
 *
 * `⌘⇧G`(`grep_vault`)는 **Rust `regex`** 로 찾는다. 이 모듈은 **JS `RegExp`** 로 바꾼다.
 * 둘은 매치 지점이 다를 수 있다 — Rust 쪽에 역참조·lookaround가 없고, 유니코드 경계
 * 처리도 완전히 같지 않다(`tauri/grep.ts` 주석에 이미 적혀 있다).
 *
 * 그래서 **grep이 보여준 목록을 그대로 "바뀔 것"으로 쓰지 않는다.** 이 모듈이 자기
 * 엔진으로 다시 찾아 **자기 건수**를 내고, 확인 화면은 그 숫자를 보여준다. 안 그러면
 * "보여준 것과 바꾼 것이 다른" 상태가 조용히 생긴다.
 *
 * CLI(`lapis replace`)는 grep을 아예 거치지 않으므로 그 문제가 없다.
 *
 * ## 안전은 알갱이가 아니라 절차에서 온다
 *
 * 매치 단위로 **보여주고** 파일 단위로 **적용한다.** 매치 단위 선택은 쓰기 레이어에 새
 * 알갱이를 도입해야 해서 이 범위 밖이다. 대신 기본 dry-run · 목록 확인 · 백업 · 롤백을
 * 거친다 — 이미 나가 있는 `tag rename`과 같은 수준이다.
 */

/** 읽을 수 없는 패턴. 조용히 리터럴로 떨어뜨리면 엉뚱한 것을 바꾼다. */
export class ReplacePatternError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplacePatternError";
  }
}

export interface ReplaceOptions {
  /** 정규식으로 볼지. 기본 `false`(리터럴) — `⌘⇧G`와 같은 기본값이다. */
  regex?: boolean;
  /** 기본 `true`. */
  caseSensitive?: boolean;
  /** 단어 경계로 감싼다. 기본 `false`. */
  wholeWord?: boolean;
}

export interface ReplacePreview {
  pattern: string;
  replacement: string;
  /** `linkRewrite`와 **같은 모양** — 적용 트랜잭션을 그대로 재사용한다. */
  items: LinkRewritePreviewItem[];
  totalOccurrences: number;
  /**
   * 그중 **프론트매터 안**의 매치 수.
   *
   * ⚠️ 막지 않는다 — `2026`을 `2027`로 바꾸는 것처럼 의도적인 경우가 있다. 다만 YAML이
   * 깨질 수 있으므로 **몇 건인지는 말해준다.** 파일 단위 적용이라 프론트매터 하나만
   * 빼는 것은 안 되고, 그래서 미리 아는 게 더 중요하다.
   */
  frontmatterOccurrences: number;
  /**
   * 치환문이 패턴에 **다시 걸리나.**
   *
   * ⚠️ 한 번 실행이 무한 루프가 되지는 않는다(JS `replace`는 원본을 훑는다). 위험은
   * **사람이 두 번 누르는 것**이다 — `a` → `aa`를 두 번 하면 네 배가 된다. 되돌릴 수
   * 없는 쓰기에서는 미리 말해줘야 한다.
   */
  selfMatching: boolean;
}

/** 정규식 특수문자를 글자로. 리터럴 모드의 패턴에 쓴다. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * `String.replace`의 치환문 특수 시퀀스를 무력화한다.
 *
 * ⚠️ **리터럴 모드에서 반드시 필요하다.** `$&` · `$1` · `$$` 는 치환문에서 특수 의미를
 * 가지므로, 이스케이프하지 않으면 "리터럴로 바꿨는데 매치가 끼어드는" 결과가 나온다.
 * 정규식 모드에서는 그 문법이 **기능**이므로 건드리지 않는다.
 */
function escapeReplacement(s: string): string {
  return s.replace(/\$/g, "$$$$");
}

function buildPattern(pattern: string, opts: ReplaceOptions): RegExp {
  if (pattern === "") {
    throw new ReplacePatternError("빈 패턴은 모든 위치에 걸린다");
  }
  let body = opts.regex === true ? pattern : escapeRegex(pattern);
  if (opts.wholeWord === true) body = String.raw`\b(?:` + body + String.raw`)\b`;
  // `m` — `^`/`$`를 줄 단위로 본다(사용자가 기대하는 쪽이다).
  // ⚠️ `s`는 켜지 않는다. `.`이 줄바꿈을 넘으면 한 줄짜리 의도가 문서 전체를 삼킬 수
  // 있고, 되돌릴 수 없는 쓰기에서 그건 너무 큰 기본값이다. 여러 줄은 `\n`을 명시한다.
  const flags = "gm" + (opts.caseSensitive === false ? "i" : "");
  try {
    return new RegExp(body, flags);
  } catch (e) {
    throw new ReplacePatternError(`정규식을 읽을 수 없다: ${(e as Error).message}`);
  }
}

/** 프론트매터 블록의 끝 인덱스. 없으면 0. */
function frontmatterEnd(raw: string): number {
  if (!raw.startsWith("---")) return 0;
  const close = raw.indexOf("\n---", 3);
  return close === -1 ? 0 : close + 4;
}

/** 결정적 문자열 비교 — **UTF-16 코드 단위**. 로케일에 따라 갈리지 않게. */
const asc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function computeReplacePreview(
  notes: Map<string, string>,
  pattern: string,
  replacement: string,
  opts: ReplaceOptions = {},
): ReplacePreview {
  const re = buildPattern(pattern, opts);
  const repl = opts.regex === true ? replacement : escapeReplacement(replacement);

  const items: LinkRewritePreviewItem[] = [];
  let total = 0;
  let inFrontmatter = 0;

  for (const [path, raw] of notes) {
    // ⚠️ `lastIndex`가 남으면 다음 파일이 중간부터 매치된다. 매 파일마다 되돌린다.
    re.lastIndex = 0;
    const matches = [...raw.matchAll(re)];
    if (matches.length === 0) continue;

    const newContent = raw.replace(re, repl);
    // 패턴과 치환문이 같으면 바뀌는 게 없다 — 백업만 남기고 아무 일도 안 하면 안 된다.
    if (newContent === raw) continue;

    const fmEnd = frontmatterEnd(raw);
    for (const m of matches) {
      if (m.index !== undefined && m.index < fmEnd) inFrontmatter++;
    }
    total += matches.length;
    items.push({ path, occurrences: matches.length, newContent });
  }

  // 결정성 — 순서를 안 정하면 목록이 Map 삽입 순서에 흔들린다.
  items.sort((a, b) => asc(a.path, b.path));

  // 치환문이 패턴에 다시 걸리나.
  re.lastIndex = 0;
  const selfMatching = replacement !== "" && re.test(replacement);

  return {
    pattern,
    replacement,
    items,
    totalOccurrences: total,
    frontmatterOccurrences: inFrontmatter,
    selfMatching,
  };
}
