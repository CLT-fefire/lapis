import { describe, it, expect } from "vitest";
import {
  intrinsicSize,
  clampScale,
  canvasSize,
  MAX_CANVAS_AREA,
  DEFAULT_SCALE,
} from "./exportGeometry";

/**
 * 내보내기 배율.
 *
 * ## 🔴 여기서 틀리면 **에러 없이 빈 PNG** 가 저장된다
 *
 * WebKit 은 캔버스 면적 한계를 넘으면 예외를 던지지 않고 빈/검은 결과를 낸다. 내보낸
 * 사람은 성공했다고 믿고, 파일을 연 다음에야 안다 — 원인에서 한참 떨어진 자리다.
 *
 * 이 모듈이 `mermaidExport.ts` 에서 갈라져 나온 이유가 그것이다. 캔버스가 붙은 채로는
 * happy-dom 에서 **"안 돌았는데 통과"** 가 된다.
 */

describe("intrinsicSize", () => {
  it("viewBox 를 먼저 쓴다", () => {
    expect(intrinsicSize({ width: 400, height: 300 }, { width: 111, height: 222 })).toEqual({
      width: 400,
      height: 300,
    });
  });

  it("viewBox 가 없으면 렌더 크기", () => {
    expect(intrinsicSize(null, { width: 111, height: 222 })).toEqual({
      width: 111,
      height: 222,
    });
  });

  /** ⚠️ 0 을 그대로 쓰면 배율이 `Infinity` 가 되고 캔버스가 `0×0` 이 된다. */
  it("둘 다 0 이면 안전 기본값", () => {
    expect(intrinsicSize({ width: 0, height: 0 }, { width: 0, height: 0 })).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("viewBox 의 한 축만 0 이어도 기본값으로 내려간다", () => {
    // 축마다 따로 판단한다 — 한쪽만 0 인 viewBox 는 실제로 나온다.
    expect(intrinsicSize({ width: 0, height: 300 }, { width: 0, height: 0 })).toEqual({
      width: 800,
      height: 300,
    });
  });
});

describe("clampScale", () => {
  it("작은 다이어그램은 기본 배율 그대로", () => {
    expect(clampScale(400, 300)).toBe(DEFAULT_SCALE);
  });

  /** 🔴 한계를 넘기면 낮춘다 — 안 낮추면 빈 PNG 가 나온다. */
  it("한계를 넘길 크기면 배율을 낮춘다", () => {
    const w = 3000;
    const h = 2000;
    const scale = clampScale(w, h);
    expect(scale).toBeLessThan(DEFAULT_SCALE);
    expect(w * scale * (h * scale)).toBeLessThanOrEqual(MAX_CANVAS_AREA + 1);
  });

  it("정확히 한계인 크기는 그대로 통과한다", () => {
    const side = Math.sqrt(MAX_CANVAS_AREA); // 4096
    expect(clampScale(side, side, 1)).toBeCloseTo(1, 6);
  });

  /** ⚠️ 0 이나 음수를 내면 캔버스가 비고, 그리기가 조용히 아무것도 안 한다. */
  it("배율이 0 이하로 내려가지 않는다", () => {
    expect(clampScale(1e9, 1e9)).toBeGreaterThan(0);
  });

  it("면적이 0 이면 요청한 배율을 그대로 준다", () => {
    // `Infinity` 배율을 내지 않는다.
    expect(clampScale(0, 0)).toBe(DEFAULT_SCALE);
    expect(Number.isFinite(clampScale(0, 0))).toBe(true);
  });

  it("NaN 을 흘리지 않는다", () => {
    expect(Number.isFinite(clampScale(Number.NaN, 100))).toBe(true);
  });
});

describe("canvasSize", () => {
  it("배율을 적용해 반올림한다", () => {
    expect(canvasSize(400, 300, 3)).toEqual({ width: 1200, height: 900 });
  });

  /** ⚠️ `0×0` 캔버스는 예외 없이 빈 그림을 낸다. */
  it("최소 1px 을 보장한다", () => {
    expect(canvasSize(0.1, 0.1, 0.001)).toEqual({ width: 1, height: 1 });
  });
});

/**
 * ⚠️ **호출부가 이 모듈을 실제로 쓰는가.** 순수 함수가 전부 초록이어도 `mermaidExport`
 * 가 옛 계산을 그대로 들고 있으면 화면은 안 바뀐다 — 에러 없이.
 */
describe("배선", () => {
  it("mermaidExport 가 이 모듈을 쓴다", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(
      fileURLToPath(new URL("./mermaidExport.ts", import.meta.url)),
      "utf-8",
    );
    expect(src).toMatch(/from "\$lib\/exportGeometry"/);
    expect(src).toMatch(/clampScale\(/);
    expect(src).toMatch(/canvasSize\(/);
    expect(src).toMatch(/intrinsicSize\(/);
    // 옛 계산이 남아 있으면 두 벌이 된다.
    expect(src, "옛 배율 계산이 남아 있다").not.toMatch(/Math\.sqrt\(MAX_CANVAS_AREA/);
  });
});
