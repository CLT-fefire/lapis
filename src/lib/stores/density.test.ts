import { describe, it, expect } from "vitest";
import { DENSITIES, normalizeDensity } from "./density";

/**
 * 밀도 **3단** — 3.0.
 *
 * v2.0.0 은 2단이었고 주석이 그 이유를 적고 있었다: "Discord 는 3단을 넣고도 모든
 * 단계가 조밀하면서 동시에 헐렁하다는 평을 받았다". 그 평은 **간격 토큰이 반쪽만
 * 움직였을 때** 나오는 것이지 단계 수의 문제가 아니다 — 3.0 은 `app.css` 한 블록에서
 * 전부 움직인다.
 */
describe("밀도 3단", () => {
  it("순서가 여유 → 기본 → 조밀", () => {
    expect([...DENSITIES]).toEqual(["cozy", "default", "compact"]);
  });

  /**
   * ⚠️ **옛 값 둘은 그대로 유효하다.** 마이그레이션이 필요한 쪽은 새로 생긴 `cozy`
   * 뿐이다. 여기서 옛 값을 못 읽으면 조밀을 쓰던 사람이 기본으로 되돌아가는데,
   * 그건 에러 없이 "설정이 날아갔다"로 읽힌다.
   */
  it("옛 값 둘을 그대로 읽는다", () => {
    expect(normalizeDensity("default")).toBe("default");
    expect(normalizeDensity("compact")).toBe("compact");
  });

  it("새 값도 읽는다", () => {
    expect(normalizeDensity("cozy")).toBe("cozy");
  });

  it("모르는 값·없는 값은 기본", () => {
    for (const bad of [null, undefined, "", "spacious", 3, {}]) {
      expect(normalizeDensity(bad), JSON.stringify(bad)).toBe("default");
    }
  });
});
