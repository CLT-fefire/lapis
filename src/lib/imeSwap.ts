import { decomposeSyllable } from "$lib/hangul";

/**
 * **한글 IME 를 켠 채 영문을 쳤을 때 되돌리기.**
 *
 * ## 🔴 왜 있나 — 실사용 로그에서 나왔다 (2026-08-30)
 *
 * `lapis usage` 의 "결과가 0건이던 질의" 아홉 중 **일곱**이 한 모양이었다:
 *
 * ```
 * ㄴㄷ셔ㅔ        → setup
 * ㄴㄷ셔ㅔㅠㅁㄴ     → setupbas   (2회)
 * ㄴㄷ셔ㅔㅠㅁㄴㄷ    → setupbase
 * ```
 *
 * 한 검색에서 키를 칠 때마다 0건을 받았다. 그런데 **찾던 노트는 있었다** —
 * `vibecoding-setup-baseline-20260830.md`. 사용자는 결국 못 찾았다.
 *
 * ## ⚠️ 이건 추정이 아니다
 *
 * 두벌식 ↔ QWERTY 는 **자판에 새겨진 고정 표**다. "비슷한 것"을 편집거리로 찾는 게
 * 아니라 되돌릴 수 있는 사상이라, 태그 감사에서 오타 탐지를 뺀 이유
 * (*"오탐을 섞으면 목록 자체를 안 믿게 된다"*)에 걸리지 않는다.
 *
 * ## ⚠️ 부르는 쪽의 규칙
 *
 * - **0건일 때만** 쓴다. 되는 질의의 순위를 건드리면 안 된다.
 * - 바꿔서 찾았으면 **그렇게 말한다.** 조용히 다른 것을 찾아 주면 사용자는 왜 그게
 *   나왔는지 모르고, 그러면 다음부터 결과를 안 믿는다.
 *
 * ## ⚠️ 반대 방향은 없다
 *
 * 영문 IME 로 한글을 치는 경우(`tjfwjd` → `설정`)는 **안 만들었다.** 자모를 음절로
 * 조합하는 오토마타가 필요해 훨씬 크고, **이 로그에는 그 모양이 0건**이다.
 * 한국에서 흔한 불편이지만 여기서 잰 것이 아니라 근거가 없다.
 */

/**
 * 호환 자모 → 두벌식 자판의 QWERTY 키.
 *
 * ⚠️ 쌍자음(`ㄲ`·`ㄸ`…)은 **shift 자리**라 대문자로 나간다. 검색은 소문자로 비교하므로
 * 실용상 차이가 없지만, 되돌린 것이 실제로 누른 키와 같아야 이 표를 나중에 믿을 수 있다.
 */
const KEY: Readonly<Record<string, string>> = {
  // 자음
  ㅂ: "q", ㅃ: "Q", ㅈ: "w", ㅉ: "W", ㄷ: "e", ㄸ: "E", ㄱ: "r", ㄲ: "R",
  ㅅ: "t", ㅆ: "T", ㅁ: "a", ㄴ: "s", ㅇ: "d", ㄹ: "f", ㅎ: "g",
  ㅋ: "z", ㅌ: "x", ㅊ: "c", ㅍ: "v",
  // 모음
  ㅛ: "y", ㅕ: "u", ㅑ: "i", ㅐ: "o", ㅒ: "O", ㅔ: "p", ㅖ: "P",
  ㅗ: "h", ㅓ: "j", ㅏ: "k", ㅣ: "l", ㅠ: "b", ㅜ: "n", ㅡ: "m",
};

/**
 * 자판에 **키가 하나뿐인** 겹자모 — 두 키를 눌러 만든 것이라 둘로 되돌린다.
 *
 * ⚠️ 이걸 빼면 `과` 가 `r?` 가 되고, 되돌린 문자열이 조용히 짧아진다.
 */
const COMPOUND: Readonly<Record<string, string>> = {
  // 겹받침
  ㄳ: "ㄱㅅ", ㄵ: "ㄴㅈ", ㄶ: "ㄴㅎ", ㄺ: "ㄹㄱ", ㄻ: "ㄹㅁ", ㄼ: "ㄹㅂ",
  ㄽ: "ㄹㅅ", ㄾ: "ㄹㅌ", ㄿ: "ㄹㅍ", ㅀ: "ㄹㅎ", ㅄ: "ㅂㅅ",
  // 겹모음
  ㅘ: "ㅗㅏ", ㅙ: "ㅗㅐ", ㅚ: "ㅗㅣ", ㅝ: "ㅜㅓ", ㅞ: "ㅜㅔ", ㅟ: "ㅜㅣ", ㅢ: "ㅡㅣ",
};

/** 이 자모가 QWERTY 키로 되돌려지나. */
function keysFor(jamo: string): string | null {
  const compound = COMPOUND[jamo];
  if (compound) {
    let out = "";
    for (const part of compound) {
      const k = KEY[part];
      if (k === undefined) return null;
      out += k;
    }
    return out;
  }
  return KEY[jamo] ?? null;
}

/**
 * 한글로 찍힌 것을 **눌렀을 키**로 되돌린다. 되돌릴 게 없으면 `null`.
 *
 * ⚠️ 한글이 아닌 글자(숫자·하이픈·공백·라틴)는 **그대로 둔다.** `ㄴㄷ셔ㅔ-2026` 처럼
 * 섞여 들어오는 일이 실제로 있다.
 *
 * ⚠️ **바뀐 게 없으면 `null` 이다.** 표에 없는 한글만 있을 때 원문과 같은 문자열을
 * 돌려주면, 부르는 쪽이 같은 질의를 한 번 더 돌리고 여전히 0건을 받는다.
 */
export function hangulToQwerty(query: string): string | null {
  let out = "";
  let swapped = false;

  for (const ch of query) {
    const jamos = decomposeSyllable(ch);
    // 한글이 아니면 `decomposeSyllable` 이 원문 한 글자를 그대로 돌려준다.
    const isHangul = jamos.length > 1 || (jamos[0] === ch && keysFor(ch) !== null);
    if (!isHangul) {
      out += ch;
      continue;
    }
    let piece = "";
    let ok = true;
    for (const j of jamos) {
      const k = keysFor(j);
      if (k === null) {
        ok = false;
        break;
      }
      piece += k;
    }
    if (!ok) {
      // 표에 없는 자모 — 되돌리지 않고 원문을 남긴다. 조용히 지우지 않는다.
      out += ch;
      continue;
    }
    out += piece;
    swapped = true;
  }

  return swapped ? out : null;
}
