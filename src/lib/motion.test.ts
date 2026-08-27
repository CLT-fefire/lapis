import { describe, it, expect, afterEach, vi } from "vitest";
import {
  dur,
  prefersReducedMotion,
  backdropFade,
  cardIn,
  cardOut,
  menuPop,
  MOTION_FAST,
  MOTION_BASE,
  MOTION_SLOW,
  MOTION_SCRIM,
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
  it("평소 duration은 --dur-* 척도와 모션 명세를 따른다", () => {
    stubMatchMedia(false);
    expect(backdropFade().duration).toBe(MOTION_SCRIM);
    expect(cardIn().duration).toBe(MOTION_SLOW);
    expect(menuPop().duration).toBe(MOTION_FAST);
  });

  /**
   * ⚠️ **닫기가 열기보다 빨라야 한다.** 닫는 동작은 결과를 기다리는 동작이 아니라
   * 물러나는 동작이라, 같은 길이면 느리게 **느껴진다**.
   */
  it("퇴장이 등장보다 짧다", () => {
    stubMatchMedia(false);
    expect(cardOut().duration).toBeLessThan(cardIn().duration);
    expect(cardOut().duration).toBe(MOTION_BASE);
  });

  it("reduce면 **모든** 프리셋이 0 — 하나라도 새면 접근성 회귀다", () => {
    stubMatchMedia(true);
    expect(backdropFade().duration).toBe(0);
    expect(cardIn().duration).toBe(0);
    expect(cardOut().duration).toBe(0);
    expect(menuPop().duration).toBe(0);
  });

  it("pop 시작 배율은 과장되지 않는 범위를 유지한다", () => {
    stubMatchMedia(false);
    expect(menuPop().start).toBeGreaterThanOrEqual(0.94);
    expect(menuPop().start).toBeLessThan(1);
  });

  /**
   * 카드는 `css`로 직접 transform 을 만든다 — `t=0` 이 시작, `t=1` 이 제자리.
   * ⚠️ `t=1` 에서 transform 이 남아 있으면 모달이 **영구히 어긋난 자리**에 선다.
   */
  it("카드는 t=1에서 제자리다", () => {
    stubMatchMedia(false);
    const end = cardIn().css(1);
    expect(end).toContain("opacity: 1");
    expect(end).toContain("translateY(0px)");
    expect(end).toContain("scale(1)");
  });

  it("카드는 t=0에서 위로 밀려 있고 작다", () => {
    stubMatchMedia(false);
    const start = cardIn().css(0);
    expect(start).toContain("opacity: 0");
    expect(start).toContain("translateY(-8px)");
    expect(start).toContain("scale(0.97)");
  });
});
