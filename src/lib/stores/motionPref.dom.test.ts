import { describe, it, expect, afterEach } from "vitest";
import { MOTION_PREFS, normalizeMotionPref, shouldReduceMotion } from "./motionPref";

/**
 * 애니메이션 3단.
 *
 * ⚠️ 여기서 조용히 틀리는 방법은 **설정이 시스템을 못 이기는 것**이다. 사용자가 "최소"를
 * 골랐는데 OS 가 아무 말 안 했다는 이유로 모션이 그대로 돌면, 설정 화면은 바뀌었고
 * 화면은 안 바뀐다 — 에러 없이.
 */

const html = () => (typeof document === "undefined" ? null : document.documentElement);

afterEach(() => {
  const el = html();
  if (el) delete el.dataset.motion;
});

describe("정규화", () => {
  it("셋이다", () => {
    expect([...MOTION_PREFS]).toEqual(["system", "minimal", "full"]);
  });

  it("모르는 값은 system", () => {
    for (const bad of [null, undefined, "", "none", 0, {}]) {
      expect(normalizeMotionPref(bad), JSON.stringify(bad)).toBe("system");
    }
  });
});

describe("shouldReduceMotion — 설정이 시스템을 이긴다", () => {
  it("system: OS 를 그대로 따른다", () => {
    expect(shouldReduceMotion(true)).toBe(true);
    expect(shouldReduceMotion(false)).toBe(false);
  });

  it("minimal: OS 가 조용해도 줄인다", () => {
    html()!.dataset.motion = "minimal";
    expect(shouldReduceMotion(false)).toBe(true);
  });

  /** ⚠️ 이 방향이 특히 중요하다 — OS 에서 줄여 뒀지만 이 앱에서는 보고 싶은 경우. */
  it("full: OS 가 줄이라 해도 켠다", () => {
    html()!.dataset.motion = "full";
    expect(shouldReduceMotion(true)).toBe(false);
  });

  it("속성이 깨져 있으면 system 처럼 군다", () => {
    html()!.dataset.motion = "없는값";
    expect(shouldReduceMotion(true)).toBe(true);
    expect(shouldReduceMotion(false)).toBe(false);
  });
});
