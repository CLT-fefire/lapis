import { describe, it, expect } from "vitest";
import {
  clampFontSize,
  READING_FONT_MIN,
  READING_FONT_MAX,
  READING_FONT_DEFAULT,
} from "./reading";

describe("clampFontSize", () => {
  it("범위 내 값은 그대로(정수)", () => {
    expect(clampFontSize(15)).toBe(15);
    expect(clampFontSize(20)).toBe(20);
  });

  it("하한 미만은 MIN으로", () => {
    expect(clampFontSize(5)).toBe(READING_FONT_MIN);
    expect(clampFontSize(READING_FONT_MIN - 1)).toBe(READING_FONT_MIN);
  });

  it("상한 초과는 MAX로", () => {
    expect(clampFontSize(99)).toBe(READING_FONT_MAX);
    expect(clampFontSize(READING_FONT_MAX + 1)).toBe(READING_FONT_MAX);
  });

  it("소수는 반올림", () => {
    expect(clampFontSize(15.4)).toBe(15);
    expect(clampFontSize(15.6)).toBe(16);
  });

  it("NaN/비정상은 기본값", () => {
    expect(clampFontSize(NaN)).toBe(READING_FONT_DEFAULT);
    expect(clampFontSize(Infinity)).toBe(READING_FONT_DEFAULT);
  });
});
