/**
 * 내보내기의 **캔버스 없는 알맹이** — 크기와 배율.
 *
 * ## ⚠️ 왜 따로 빼나
 *
 * `mermaidExport.ts` 는 캔버스를 쓴다. happy-dom 에는 렌더링이 없어서 그 함수를 그대로
 * 부르면 **"안 돌았는데 통과"** 가 된다 — 이 저장소가 가장 경계하는 결과다. 그래서
 * 판단이 들어 있는 부분만 순수 함수로 내려놓고, 캔버스 호출부는 이 결과를 쓰기만 한다.
 *
 * `previewExportDoc.ts` 가 문서 조립에 대해 같은 일을 한다.
 */

/**
 * WebKit(WKWebView) 캔버스 면적 한계 ≈ 16,777,216 px²(≈4096×4096).
 *
 * ⚠️ 넘으면 **에러가 아니라 빈/검은 PNG** 가 나온다. 큰 다이어그램을 내보낸 사람은
 * 저장이 성공했다고 믿고 파일을 연 다음에야 안다.
 */
export const MAX_CANVAS_AREA = 16_777_216;

/** 기본 배율 — 화면보다 선명하게 뽑기 위한 것. */
export const DEFAULT_SCALE = 3;

/**
 * SVG 의 내재 크기 — `viewBox` 우선, 없으면 렌더 크기, 그것도 0이면 안전 기본값.
 *
 * ⚠️ 0 을 그대로 쓰면 배율 계산이 `Infinity` 가 되고 캔버스가 `0×0` 으로 만들어진다.
 */
export function intrinsicSize(
  viewBox: { width: number; height: number } | null,
  rect: { width: number; height: number },
): { width: number; height: number } {
  return {
    width: viewBox?.width || rect.width || 800,
    height: viewBox?.height || rect.height || 600,
  };
}

/**
 * 면적 한계에 맞춘 배율. 기본 배율을 넘지 않되, 한계를 넘길 크기면 더 낮춘다.
 *
 * ⚠️ **0 이나 음수를 내지 않는다.** 캔버스 크기가 0 이면 그리기가 조용히 아무것도 안 한다.
 */
export function clampScale(
  width: number,
  height: number,
  requested = DEFAULT_SCALE,
  maxArea = MAX_CANVAS_AREA,
): number {
  const area = width * height;
  if (!Number.isFinite(area) || area <= 0) return requested;
  const fit = Math.sqrt(maxArea / area);
  return Math.max(Number.MIN_VALUE, Math.min(requested, fit));
}

/** 배율을 적용한 캔버스 픽셀 크기. 최소 1px — `0×0` 캔버스는 조용히 빈 그림을 낸다. */
export function canvasSize(
  width: number,
  height: number,
  scale: number,
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
