import { describe, it, expect, afterEach, vi } from "vitest";
import {
  dur,
  prefersReducedMotion,
  backdropFade,
  cardPop,
  menuPop,
  MOTION_FAST,
  MOTION_BASE,
} from "./motion";

/**
 * 접근성 회귀 방지 (PR-8, 2026-08-05).
 *
 * app.css의 `@media (prefers-reduced-motion: reduce)`는 **CSS** transition/animation만
 * 무력화한다. Svelte transition은 JS가 duration을 쥐고 있어 그 규칙을 우회하므로,
 * 모든 전환이 이 헬퍼를 거쳐야 한다. 여기서 "거치면 실제로 0이 된다"를 고정한다.
 */

function stubMatchMedia(reduce: boolean) {
  vi.stubGlobal("window", {
    matchMedia: (q: string) => ({ matches: reduce && q.includes("prefers-reduced-motion") }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prefersReducedMotion", () => {
  it("reduce 설정이면 true", () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it("설정이 없으면 false", () => {
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("matchMedia가 없는 환경(SSR 등)에서도 던지지 않고 false", () => {
    vi.stubGlobal("window", {});
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("dur", () => {
  it("평소에는 값을 그대로 통과시킨다", () => {
    stubMatchMedia(false);
    expect(dur(150)).toBe(150);
  });

  it("reduce면 0으로 떨어뜨린다", () => {
    stubMatchMedia(true);
    expect(dur(150)).toBe(0);
  });
});

describe("전환 프리셋", () => {
  it("평소 duration은 --dur-* 척도를 따른다", () => {
    stubMatchMedia(false);
    expect(backdropFade().duration).toBe(MOTION_FAST);
    expect(cardPop().duration).toBe(MOTION_BASE);
    expect(menuPop().duration).toBe(MOTION_FAST);
  });

  it("reduce면 **모든** 프리셋이 0 — 하나라도 새면 접근성 회귀다", () => {
    stubMatchMedia(true);
    expect(backdropFade().duration).toBe(0);
    expect(cardPop().duration).toBe(0);
    expect(menuPop().duration).toBe(0);
  });

  it("pop 시작 배율은 과장되지 않는 범위를 유지한다", () => {
    stubMatchMedia(false);
    expect(cardPop().start).toBeGreaterThanOrEqual(0.94);
    expect(menuPop().start).toBeGreaterThanOrEqual(0.94);
    expect(cardPop().start).toBeLessThan(1);
    expect(menuPop().start).toBeLessThan(1);
  });
});
