import { describe, it, expect } from "vitest";
import { hangulToQwerty } from "./imeSwap";

/**
 * 한글 IME 를 켠 채 영문을 쳤을 때 되돌리기.
 *
 * ## 🔴 왜 만들었나 — 추측이 아니라 실사용 로그다 (2026-08-30)
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
 * `vibecoding-setup-baseline-20260830.md`.
 *
 * ## ⚠️ 이건 추정이 아니다
 *
 * 두벌식 ↔ QWERTY 는 **고정 표**다. 편집거리로 "비슷한 것"을 찾는 게 아니라 되돌릴 수
 * 있는 사상이라, 태그 감사에서 오타 탐지를 뺀 이유에 걸리지 않는다.
 *
 * ⚠️ 부르는 쪽은 **0건일 때만** 쓴다. 되는 질의의 순위를 건드리면 안 된다.
 */
describe("hangulToQwerty", () => {
  it("실제로 로그에 남은 그 질의들", () => {
    expect(hangulToQwerty("ㄴㄷ셔ㅔ")).toBe("setup");
    expect(hangulToQwerty("ㄴㄷ셔ㅔㅠ")).toBe("setupb");
    expect(hangulToQwerty("ㄴㄷ셔ㅔㅠㅁ")).toBe("setupba");
    expect(hangulToQwerty("ㄴㄷ셔ㅔㅠㅁㄴ")).toBe("setupbas");
    expect(hangulToQwerty("ㄴㄷ셔ㅔㅠㅁㄴㄷ")).toBe("setupbase");
  });

  it("완성된 음절을 자모로 풀어 옮긴다", () => {
    // 각=ㄱㅏㄱ → r k r
    expect(hangulToQwerty("각")).toBe("rkr");
    // 한글 → ㅎㅏㄴ ㄱㅡㄹ → g k s / r m f
    expect(hangulToQwerty("한글")).toBe("gksrmf");
  });

  it("겹받침을 두 글자로 푼다", () => {
    // 앉 = ㅇ ㅏ ㄵ(ㄴ+ㅈ) → d k s w
    expect(hangulToQwerty("앉")).toBe("dksw");
  });

  it("겹모음을 두 글자로 푼다", () => {
    // 과 = ㄱ ㅘ(ㅗ+ㅏ) → r h k
    expect(hangulToQwerty("과")).toBe("rhk");
  });

  it("쌍자음은 shift 자리라 대문자로 나간다", () => {
    // 까 = ㄲ ㅏ → R k
    expect(hangulToQwerty("까")).toBe("Rk");
    // ㅃ → Q
    expect(hangulToQwerty("ㅃ")).toBe("Q");
  });

  // ── 안 건드리는 것 ───────────────────────────────────────────────────────
  // ⚠️ 되돌릴 수 있는 것만 바꾼다. 모르는 글자를 흘리면 결과가 조용히 이상해진다.

  it("한글이 아닌 글자는 그대로 둔다", () => {
    expect(hangulToQwerty("ㄴㄷ셔ㅔ-2026")).toBe("setup-2026");
    expect(hangulToQwerty("ㅁ b ㄴ")).toBe("a b s");
  });

  it("한글이 하나도 없으면 null — 부를 필요가 없다는 신호", () => {
    expect(hangulToQwerty("setup")).toBeNull();
    expect(hangulToQwerty("")).toBeNull();
    expect(hangulToQwerty("2026-08-30")).toBeNull();
  });

  /**
   * ⚠️ **바뀐 게 없으면 `null`.** 표에 없는 한글(옛한글 자모 등)만 있으면 원문과 같은
   * 문자열이 나오는데, 그걸 "바꿨다"고 하면 부르는 쪽이 같은 질의를 두 번 돌린다.
   */
  it("표에 없는 한글만 있으면 null", () => {
    expect(hangulToQwerty("ㆍ")).toBeNull();
  });
});
