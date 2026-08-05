import { writable } from "svelte/store";

const FONT_SIZE_KEY = "lapis.reading-font-size";
const MEASURE_KEY = "lapis.reading-measure-limited";

export const READING_FONT_MIN = 12;
export const READING_FONT_MAX = 24;
// 16px — 한글 본문 기준. 같은 px에서 한글은 라틴보다 획이 조밀해 15px면 장문에서 빡빡하다.
// ⚠️ 이 값은 **새 설치에만** 적용된다. 기존 사용자는 이미 localStorage에 값이 박혀 있으므로
//    (아래 subscribe가 시동 시 즉시 저장한다) Aa 팝오버의 "리셋"을 눌러야 새 기본을 받는다.
export const READING_FONT_DEFAULT = 16;

/** 12~24 범위로 clamp + 정수 반올림. NaN/비정상은 기본값. 순수. */
export function clampFontSize(n: number): number {
  if (!Number.isFinite(n)) return READING_FONT_DEFAULT;
  return Math.max(READING_FONT_MIN, Math.min(READING_FONT_MAX, Math.round(n)));
}

/** 프리뷰 본문 글꼴 크기(px). vault 무관 전역, localStorage 영속. */
export const readingFontSize = writable<number>(loadFontSize());

readingFontSize.subscribe(persistFontSize);

export function setReadingFontSize(n: number): void {
  readingFontSize.set(clampFontSize(n));
}

export function increaseFontSize(): void {
  readingFontSize.update((n) => clampFontSize(n + 1));
}

export function decreaseFontSize(): void {
  readingFontSize.update((n) => clampFontSize(n - 1));
}

export function resetFontSize(): void {
  readingFontSize.set(READING_FONT_DEFAULT);
}

/**
 * 본문 폭(measure) 제한 여부. 켜짐이 기본 — 폭이 넓을수록 줄 끝에서 다음 줄 첫 글자로
 * 되돌아오는 거리가 길어져 줄을 놓친다(Obsidian의 "Readable line length"도 기본 ON).
 *
 * 실제 폭 값은 CSS 토큰 `--reading-measure`(app.css) 하나가 갖는다. 여기서는 켬/끔만
 * 다루고, 끄면 `+page.svelte`가 article에 인라인으로 `none`을 주입한다.
 */
export const readingMeasureLimited = writable<boolean>(loadMeasureLimited());

readingMeasureLimited.subscribe(persistMeasureLimited);

export function setReadingMeasureLimited(on: boolean): void {
  readingMeasureLimited.set(on);
}

// === localStorage 래퍼 (미지원/vitest stub 안전) ===

function loadFontSize(): number {
  try {
    const raw = localStorage.getItem(FONT_SIZE_KEY);
    if (raw) return clampFontSize(Number(raw));
  } catch (e) {
    // 미지원 — 기본값
  }
  return READING_FONT_DEFAULT;
}

function persistFontSize(n: number): void {
  try {
    localStorage.setItem(FONT_SIZE_KEY, String(n));
  } catch (e) {
    // 미지원 — 영속화 생략
  }
}

function loadMeasureLimited(): boolean {
  try {
    // 저장값이 없으면 기본 ON. "false"만 끔으로 친다.
    return localStorage.getItem(MEASURE_KEY) !== "false";
  } catch (e) {
    // 미지원 — 기본값
  }
  return true;
}

function persistMeasureLimited(on: boolean): void {
  try {
    localStorage.setItem(MEASURE_KEY, String(on));
  } catch (e) {
    // 미지원 — 영속화 생략
  }
}
