import { describe, it, expect } from "vitest";
import { computeTextStats, readingTimeLabel } from "./textStats";

describe("computeTextStats", () => {
  it("빈 문자열/공백만 → 모두 0", () => {
    expect(computeTextStats("")).toEqual({
      words: 0,
      chars: 0,
      charsNoSpaces: 0,
      readingMinutes: 0,
    });
    expect(computeTextStats("   \n\t  ")).toEqual({
      words: 0,
      chars: 0,
      charsNoSpaces: 0,
      readingMinutes: 0,
    });
  });

  it("영문 단어 수 = 공백 토큰 수", () => {
    const s = computeTextStats("hello world foo");
    expect(s.words).toBe(3);
    expect(s.chars).toBe(15);
    expect(s.charsNoSpaces).toBe(13);
    expect(s.readingMinutes).toBe(1);
  });

  it("frontmatter는 통계에서 제외", () => {
    const raw = "---\ntitle: Hello\ntags: [a, b]\n---\nHello world body";
    const s = computeTextStats(raw);
    // 본문 "Hello world body"만 → 3 단어
    expect(s.words).toBe(3);
  });

  it("charsNoSpaces는 모든 공백(개행 포함) 제외", () => {
    const s = computeTextStats("a b\nc");
    expect(s.chars).toBe(5);
    expect(s.charsNoSpaces).toBe(3);
  });

  it("한국어(CJK)는 글자 단위로 읽기시간 추정 (~500자/분)", () => {
    expect(computeTextStats("가".repeat(500)).readingMinutes).toBe(1);
    expect(computeTextStats("가".repeat(501)).readingMinutes).toBe(2);
    const ko = computeTextStats("안녕하세요 반갑습니다");
    expect(ko.words).toBe(2); // 2 어절
    expect(ko.readingMinutes).toBe(1);
  });

  it("라틴 단어는 ~200단어/분", () => {
    expect(computeTextStats(("word ".repeat(200)).trim()).readingMinutes).toBe(
      1,
    );
    expect(computeTextStats(("word ".repeat(201)).trim()).readingMinutes).toBe(
      2,
    );
  });

  it("CJK + 라틴 혼합 → 읽기시간 블렌딩", () => {
    // 500 CJK(=1.0) + 200 라틴 단어(=1.0) = 2.0 → 2분
    const mixed = "가".repeat(500) + " " + "word ".repeat(200).trim();
    expect(computeTextStats(mixed).readingMinutes).toBe(2);
  });

  it("코드포인트 기준 카운트 (멀티바이트 안전)", () => {
    // 한글 1자 = 1 코드포인트
    expect(computeTextStats("한").charsNoSpaces).toBe(1);
  });
});

describe("readingTimeLabel", () => {
  it("0 이하 → 대시", () => {
    expect(readingTimeLabel(0)).toBe("—");
    expect(readingTimeLabel(-1)).toBe("—");
  });
  it("양수 → '약 N분'", () => {
    expect(readingTimeLabel(3)).toBe("약 3분");
  });
});
