import { describe, it, expect } from "vitest";
import { koBigramTokenize, normalizeTerm } from "./koTokenize";

describe("koBigramTokenize", () => {
  it("한글 어절을 겹치는 bigram으로", () => {
    expect(koBigramTokenize("검색엔진")).toEqual(["검색", "색엔", "엔진"]);
    expect(koBigramTokenize("검색의")).toEqual(["검색", "색의"]);
  });

  it("합성어 내부 substring이 토큰으로 노출 (recall 핵심)", () => {
    // "정보검색을" → "검색" bigram 포함 → 쿼리 "검색"(=bigram 검색)과 매칭
    expect(koBigramTokenize("정보검색을")).toContain("검색");
  });

  it("영어/숫자/식별자는 단어 통째 (bigram 안 함)", () => {
    expect(koBigramTokenize("JavaScript")).toEqual(["JavaScript"]);
    expect(koBigramTokenize("v1.2 release")).toEqual(["v1", "2", "release"]);
  });

  it("한글+영어 혼합 토큰을 런 단위로 분리", () => {
    expect(koBigramTokenize("검색API")).toEqual(["검색", "API"]);
    expect(koBigramTokenize("API검색엔진")).toEqual(["API", "검색", "색엔", "엔진"]);
  });

  it("공백/구두점으로 1차 split", () => {
    expect(koBigramTokenize("빠른 검색, 효율")).toEqual(["빠른", "검색", "효율"]);
  });

  it("한글 1글자는 그대로(bigram 불가)", () => {
    expect(koBigramTokenize("물")).toEqual(["물"]);
  });

  it("빈 문자열·공백만", () => {
    expect(koBigramTokenize("")).toEqual([]);
    expect(koBigramTokenize("   \n\t ")).toEqual([]);
  });

  it("쿼리와 인덱스 토큰화 일관 — 쿼리 bigram이 인덱스 bigram의 부분집합", () => {
    const indexed = new Set(koBigramTokenize("정보검색엔진을 빠르게"));
    const query = koBigramTokenize("검색엔진");
    expect(query.every((t) => indexed.has(t))).toBe(true);
  });
});

describe("normalizeTerm", () => {
  it("소문자화", () => {
    expect(normalizeTerm("HELLO")).toBe("hello");
    expect(normalizeTerm("CamelCase")).toBe("camelcase");
  });

  it("NFD(자모 분리형) → NFC 단일 음절", () => {
    // ᄀ(U+1100) ᅡ(U+1161) ᆨ(U+11A8) = 분리형 '각' → 정규화 시 단일 음절(U+AC01)
    const nfd = String.fromCharCode(0x1100, 0x1161, 0x11a8);
    expect(nfd.length).toBe(3); // 분리형은 3 코드유닛
    const normalized = normalizeTerm(nfd);
    expect(normalized.length).toBe(1); // NFC 후 1 음절
    expect(normalized).toBe(String.fromCharCode(0xac01)); // '각'
  });
});
