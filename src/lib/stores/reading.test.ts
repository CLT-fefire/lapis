import { describe, it, expect } from "vitest";
import { get } from "svelte/store";
import {
  clampFontSize,
  READING_FONT_MIN,
  READING_FONT_MAX,
  READING_FONT_DEFAULT,
  clampMeasure,
  widenMeasure,
  narrowMeasure,
  resetReading,
  readingMeasureEm,
  readingMeasureLimited,
  READING_MEASURE_MIN,
  READING_MEASURE_MAX,
  READING_MEASURE_STEP,
  READING_MEASURE_DEFAULT,
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

describe("clampMeasure", () => {
  it("STEP 단위로 반올림한다", () => {
    expect(clampMeasure(READING_MEASURE_MIN + 1)).toBe(READING_MEASURE_MIN);
    expect(clampMeasure(READING_MEASURE_MIN + 3)).toBe(
      READING_MEASURE_MIN + READING_MEASURE_STEP,
    );
  });

  it("범위 밖은 MIN/MAX로", () => {
    expect(clampMeasure(0)).toBe(READING_MEASURE_MIN);
    expect(clampMeasure(9999)).toBe(READING_MEASURE_MAX);
  });

  it("NaN/비정상은 기본값", () => {
    expect(clampMeasure(NaN)).toBe(READING_MEASURE_DEFAULT);
    expect(clampMeasure(Infinity)).toBe(READING_MEASURE_DEFAULT);
  });
});

/* 넓게/좁게의 **양 끝 전이**가 이 컨트롤의 유일한 비자명 지점이다:
   MAX에서 한 번 더 넓히면 무제한으로 빠지고, 무제한에서 좁히면 MAX로 되돌아온다. */
describe("widenMeasure / narrowMeasure 경계", () => {
  it("MAX에서 넓히면 무제한이 된다", () => {
    resetReading();
    readingMeasureEm.set(READING_MEASURE_MAX);
    widenMeasure();
    expect(get(readingMeasureLimited)).toBe(false);
  });

  it("무제한에서 더 넓혀도 그대로다", () => {
    resetReading();
    readingMeasureLimited.set(false);
    widenMeasure();
    expect(get(readingMeasureLimited)).toBe(false);
  });

  it("무제한에서 좁히면 MAX로 돌아온다", () => {
    resetReading();
    readingMeasureLimited.set(false);
    narrowMeasure();
    expect(get(readingMeasureLimited)).toBe(true);
    expect(get(readingMeasureEm)).toBe(READING_MEASURE_MAX);
  });

  it("MIN 아래로는 안 내려간다", () => {
    resetReading();
    readingMeasureEm.set(READING_MEASURE_MIN);
    narrowMeasure();
    expect(get(readingMeasureEm)).toBe(READING_MEASURE_MIN);
  });

  it("리셋은 글꼴·폭을 함께 되돌린다", () => {
    readingMeasureLimited.set(false);
    readingMeasureEm.set(READING_MEASURE_MIN);
    resetReading();
    expect(get(readingMeasureEm)).toBe(READING_MEASURE_DEFAULT);
    expect(get(readingMeasureLimited)).toBe(true);
  });
});
