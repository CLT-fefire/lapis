import { describe, it, expect } from "vitest";
import { buildSearchRegex } from "./previewHighlight";

/**
 * 문서 내 검색(`⌘F`)의 정규식 조립 — **테스트가 0이었다.**
 *
 * 순수 함수인데 옵션 조합이 여덟(regex × wholeWord × caseSensitive)이고, 잘못 만들면
 * **결과가 조용히 비거나 조용히 넘친다.** 던지지 않는 것이 특히 위험하다 — 사용자는
 * "안 찾아지네" 하고 만다.
 */

const hits = (re: RegExp | null, text: string) => (re ? [...text.matchAll(re)].map((m) => m[0]) : null);

describe("literal 모드", () => {
  it("정규식 메타문자를 글자로 본다", () => {
    const re = buildSearchRegex("a.c", {});
    expect(hits(re, "abc a.c")).toEqual(["a.c"]);
  });

  /** ⚠️ 이걸 안 escape 하면 `[` 하나로 정규식이 깨져 `null` 이 되고 검색이 죽는다. */
  it("깨진 정규식이 될 문자도 안전하다", () => {
    for (const q of ["[", "(", "*", "\\", "+?"]) {
      const re = buildSearchRegex(q, {});
      expect(re, `${q} 에서 null 이 나왔다`).not.toBeNull();
      expect(hits(re, `x${q}y`)).toEqual([q]);
    }
  });

  it("기본은 대소문자 무시", () => {
    expect(hits(buildSearchRegex("abc", {}), "ABC")).toEqual(["ABC"]);
  });

  it("caseSensitive 면 가린다", () => {
    expect(hits(buildSearchRegex("abc", { caseSensitive: true }), "ABC")).toEqual([]);
  });
});

describe("regex 모드", () => {
  it("사용자 정규식을 그대로 쓴다", () => {
    expect(hits(buildSearchRegex("a.c", { regex: true }), "abc a.c")).toEqual(["abc", "a.c"]);
  });

  /**
   * ⚠️ **깨진 정규식은 null 이다 — 던지지 않는다.** 타이핑 중에는 항상 깨진 상태를
   * 지나간다(`(` 를 치는 순간). 던지면 그때마다 화면이 죽는다.
   */
  it("깨진 정규식은 null", () => {
    expect(buildSearchRegex("(", { regex: true })).toBeNull();
    expect(buildSearchRegex("a{2,1}", { regex: true })).toBeNull();
  });
});

describe("wholeWord", () => {
  it("ASCII 질의는 낱말 경계를 요구한다", () => {
    expect(hits(buildSearchRegex("cat", { wholeWord: true }), "cat concat")).toEqual(["cat"]);
  });

  /**
   * 끝이 섞인 질의도 **양쪽 다** 낱말 경계를 요구한다.
   *
   * ⚠️ `나가cat` 은 앞에 `나`(낱말 문자)가 붙어 있으므로 **안 잡힌다.** ASCII `\b` 만
   * 쓰던 시절에는 잡혔는데, 그게 틀린 것이었다 — 한글도 낱말 문자다.
   */
  it("끝이 섞인 질의도 양쪽 경계를 요구한다", () => {
    expect(hits(buildSearchRegex("가cat", { wholeWord: true }), "가cat 나가cat")).toEqual([
      "가cat",
    ]);
  });

  /** ⚠️ 사용자 정규식을 감쌀 때 `(?:)` 로 묶어야 한다 — 안 그러면 교대(`a|b`)가 새어 나간다. */
  it("regex 와 같이 쓰면 교대가 새지 않는다", () => {
    const re = buildSearchRegex("cat|dog", { regex: true, wholeWord: true });
    expect(hits(re, "cat dog concat")).toEqual(["cat", "dog"]);
  });

  /**
   * 🔴 **한글도 진짜 낱말 경계로 갈린다.**
   *
   * 여기까지 두 단계를 거쳤다:
   *
   * 1. v3.1.1 이전 — `\b고양이\b` 는 `"고양이"` 에도 **안 맞았다.** ASCII 낱말
   *    문자와의 경계라 한글은 앞뒤가 둘 다 비-낱말이어서 경계가 아예 없다.
   *    "덜 걸린다"가 아니라 **검색이 죽었다.**
   * 2. v3.1.1 — 0건은 면했지만 경계가 없어 `검은고양이` 안의 것도 잡혔다.
   * 3. 지금 — 유니코드 낱말 문자 lookbehind 로 **standalone 만** 잡는다.
   *
   * ⚠️ lookbehind 를 못 파싱하는 엔진에서는 2단계로 떨어진다(기능 검사). 0건이 되는
   * 1단계로는 **절대 안 돌아간다** — 그게 이 폴백의 요점이다.
   */
  it("한글에서 낱말 단위가 제대로 갈린다", () => {
    expect(hits(buildSearchRegex("고양이", { wholeWord: true }), "고양이 검은고양이")).toEqual([
      "고양이",
    ]);
  });

  it("한글 질의가 0건이 되지 않는다 — 폴백 포함", () => {
    const re = buildSearchRegex("고양이", { wholeWord: true });
    expect(re).not.toBeNull();
    expect(hits(re, "고양이 를 본다")!.length).toBeGreaterThan(0);
  });
});

describe("빈 질의", () => {
  it("null 을 낸다 — 빈 정규식은 전부에 맞는다", () => {
    expect(buildSearchRegex("", {})).toBeNull();
    expect(buildSearchRegex("", { regex: true })).toBeNull();
  });
});

describe("전역 플래그", () => {
  /** ⚠️ `g` 가 없으면 `matchAll` 이 던지고 두 번째 매치를 못 찾는다. */
  it("항상 g 가 켜져 있다", () => {
    expect(buildSearchRegex("a", {})!.flags).toContain("g");
    expect(buildSearchRegex("a", { caseSensitive: true })!.flags).toContain("g");
  });
});
