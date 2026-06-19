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

/**
 * 쿼리가 "순수 초성"인가 — 공백을 제외한 모든 문자가 초성 자음(호환 자모)일 때만 true.
 * 한글 음절·모음·라틴 문자가 섞이면 false(일반 fuzzy 경로 사용).
 */
export function isChosungQuery(query: string): boolean {
  const chars = [...query].filter((c) => c.trim() !== "");
  if (chars.length === 0) return false;
  return chars.every((c) => CHOSEONG_SET.has(c));
}
