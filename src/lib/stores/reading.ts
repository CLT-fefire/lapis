import { writable } from "svelte/store";

const FONT_SIZE_KEY = "lapis.reading-font-size";

export const READING_FONT_MIN = 12;
export const READING_FONT_MAX = 24;
export const READING_FONT_DEFAULT = 15;

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
