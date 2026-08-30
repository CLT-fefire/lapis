/**
 * 한글 초성(chosung) 유틸 — Quick Switcher 초성 검색용. 외부 의존성 0 (유니코드 산식).
 *
 * 한글 음절(U+AC00–U+D7A3)은 `0xAC00 + (초성×588 + 중성×28 + 종성)` 구조라
 * 초성 인덱스 = `floor((code - 0xAC00) / 588)` 로 추출된다. 초성 19자는 호환 자모
 * (U+3131–U+314E) 중 단일 자음에 대응한다.
 *
 * 사용자가 "ㄱㅂㅈ"처럼 자음만 입력하면(IME가 받침 없는 호환 자모를 산출) 초성 쿼리로
 * 보고, 각 후보의 초성 형태에 subsequence 매칭한다.
 */

/** 초성 19자 (음절 초성 인덱스 0–18 순서, 호환 자모). */
const CHOSEONG = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];

/** 초성으로 쓰일 수 있는 호환 자모 집합(쿼리가 순수 초성인지 판별용). */
const CHOSEONG_SET = new Set(CHOSEONG);

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;

/**
 * 문자열을 초성 형태로 변환. 한글 음절은 초성 1자로, 그 외 문자는 소문자로 그대로 보존
 * (subsequence 매칭에서 위치를 유지하기 위함). 예: "검색API" → "ㄱㅅapi".
 */
export function chosungOf(str: string): string {
  let out = "";
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      out += CHOSEONG[Math.floor((code - HANGUL_BASE) / 588)];
    } else {
      out += ch.toLowerCase();
    }
  }
  return out;
}

/** 중성 21자 (음절 중성 인덱스 0–20 순서, 호환 자모). */
const JUNGSEONG = [
  "ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ",
  "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ",
];

/** 종성 28자 (인덱스 0 = 받침 없음). */
const JONGSEONG = [
  "", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ",
  "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];

/**
 * 완성된 음절 하나를 **초성·중성·종성**으로 푼다. 한글이 아니면 그대로 담아 돌려준다.
 *
 * ⚠️ `chosungOf` 와 달리 **모두** 낸다. 초성 검색은 첫 자음만 있으면 되지만, 자판을
 * 되돌리려면 사람이 실제로 누른 키가 전부 필요하다 — 받침을 빼면 `한글` 이 `gk` 가 된다.
 */
export function decomposeSyllable(ch: string): string[] {
  const code = ch.codePointAt(0);
  if (code === undefined || code < HANGUL_BASE || code > HANGUL_LAST) return [ch];
  const i = code - HANGUL_BASE;
  return [
    CHOSEONG[Math.floor(i / 588)],
    JUNGSEONG[Math.floor((i % 588) / 28)],
    JONGSEONG[i % 28],
  ].filter((x) => x !== "");
}

/**
 * 쿼리가 "순수 초성"인가 — 공백을 제외한 모든 문자가 초성 자음(호환 자모)일 때만 true.
 * 한글 음절·모음·라틴 문자가 섞이면 false(일반 fuzzy 경로 사용).
 */
export function isChosungQuery(query: string): boolean {
  const chars = [...query].filter((c) => c.trim() !== "");
  if (chars.length === 0) return false;
  return chars.every((c) => CHOSEONG_SET.has(c));
}
