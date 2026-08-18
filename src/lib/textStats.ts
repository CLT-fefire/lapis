// 현재 노트 본문의 단어/글자 수 + 예상 읽기 시간 집계.
// 한국어(+CJK)와 라틴 텍스트가 섞인 노트를 합리적으로 다루기 위해
// 읽기 시간은 "CJK 글자 ~500자/분 + 라틴 단어 ~200단어/분" 블렌딩으로 추정한다.

import { m } from "$lib/paraglide/messages.js";

export interface TextStats {
  /** 공백으로 구분된 토큰 수 (한글 어절 + 영문 단어). */
  words: number;
  /** 본문 코드포인트 수 (공백 포함). */
  chars: number;
  /** 본문 코드포인트 수 (모든 공백 제외). */
  charsNoSpaces: number;
  /** 예상 읽기 시간(분). 내용이 있으면 최소 1, 없으면 0. */
  readingMinutes: number;
}

/** parseNote와 동일한 frontmatter 블록 — 통계에서 제외. */
const FRONTMATTER_RE = /^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/;

// 한중일 문자 + 한글 음절/자모 (읽기 속도가 라틴 단어와 달라 별도 집계).
const CJK_RE =
  /[ᄀ-ᇿ　-〿぀-ヿ㄰-㆏㐀-䶿一-鿿가-힣豈-﫿＀-￯]/g;

// 라틴 글자/숫자를 하나라도 포함하는 토큰 = "라틴 단어"로 간주.
const LATIN_TOKEN_RE = /[A-Za-z0-9]/;

const CJK_CHARS_PER_MIN = 500;
const LATIN_WORDS_PER_MIN = 200;

export function computeTextStats(raw: string): TextStats {
  const body = raw.replace(FRONTMATTER_RE, "");
  const trimmed = body.trim();

  if (trimmed.length === 0) {
    return { words: 0, chars: 0, charsNoSpaces: 0, readingMinutes: 0 };
  }

  const chars = [...body].length;
  const charsNoSpaces = [...body.replace(/\s+/g, "")].length;

  const tokens = trimmed.split(/\s+/);
  const words = tokens.length;

  const cjkChars = (body.match(CJK_RE) ?? []).length;
  const latinWords = tokens.reduce(
    (n, t) => (LATIN_TOKEN_RE.test(t) ? n + 1 : n),
    0,
  );

  const rawMinutes =
    cjkChars / CJK_CHARS_PER_MIN + latinWords / LATIN_WORDS_PER_MIN;
  const readingMinutes = rawMinutes > 0 ? Math.max(1, Math.ceil(rawMinutes)) : 0;

  return { words, chars, charsNoSpaces, readingMinutes };
}

/** topbar 표시용 읽기 시간 레이블. */
export function readingTimeLabel(minutes: number): string {
  return minutes <= 0 ? m.stats_reading_none() : m.stats_reading_time({ minutes });
}
