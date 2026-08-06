import { get, writable } from "svelte/store";

const FONT_SIZE_KEY = "lapis.reading-font-size";
const MEASURE_KEY = "lapis.reading-measure-limited";
const MEASURE_EM_KEY = "lapis.reading-measure-em";

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

// === 본문 폭 (measure) ===
//
// 폭이 넓을수록 줄 끝에서 다음 줄 첫 글자로 되돌아오는 거리가 길어져 줄을 놓친다. 다만
// **얼마나 좁혀야 편한지는 순수 취향**이라 고정값을 찍지 않고 Aa 팝오버에서 조절한다
// (2026-08-06 사용자 결정 — 처음 넣은 38em은 "너무 좁다"였다).
//
// 단위가 em인 게 핵심: 글꼴을 키워도 **한 줄에 들어가는 글자 수가 유지**된다. px로 잡으면
// 글꼴을 키울수록 줄당 글자 수가 줄어 의미가 반대로 간다. 한글은 전각이라 `Nem ≈ N자`가
// 거의 그대로 성립해서, UI에도 "약 N자"로 보여준다.

export const READING_MEASURE_MIN = 40;
export const READING_MEASURE_MAX = 88;
export const READING_MEASURE_STEP = 4;
// 64em ≈ 1024px(16px 기준) — 일반적인 창에서는 사실상 걸리지 않고 외부 모니터처럼
// 아주 넓은 창에서만 멈춘다. "기존만큼 넓게"가 기본 취향이라 여기에 맞췄다.
export const READING_MEASURE_DEFAULT = 64;

/** MIN~MAX 범위로 clamp + STEP 단위 반올림. NaN/비정상은 기본값. 순수. */
export function clampMeasure(n: number): number {
  if (!Number.isFinite(n)) return READING_MEASURE_DEFAULT;
  const stepped = Math.round(n / READING_MEASURE_STEP) * READING_MEASURE_STEP;
  return Math.max(READING_MEASURE_MIN, Math.min(READING_MEASURE_MAX, stepped));
}

/**
 * 폭 제한 켬/끔. 끄면 `+page.svelte`가 article에 `--reading-measure: none`을 주입한다.
 * MAX에서 한 번 더 넓히면 여기로 넘어온다(= 무제한).
 */
export const readingMeasureLimited = writable<boolean>(loadMeasureLimited());
/** 제한이 켜져 있을 때의 폭(em). */
export const readingMeasureEm = writable<number>(loadMeasureEm());

readingMeasureLimited.subscribe(persistMeasureLimited);
readingMeasureEm.subscribe(persistMeasureEm);

export function setReadingMeasureLimited(on: boolean): void {
  readingMeasureLimited.set(on);
}

/** 넓게 — MAX에서 한 번 더 누르면 무제한으로 빠진다. */
export function widenMeasure(): void {
  if (!get(readingMeasureLimited)) return; // 이미 무제한
  const em = get(readingMeasureEm);
  if (em >= READING_MEASURE_MAX) {
    readingMeasureLimited.set(false);
    return;
  }
  readingMeasureEm.set(clampMeasure(em + READING_MEASURE_STEP));
}

/** 좁게 — 무제한에서 누르면 MAX로 되돌아온다. */
export function narrowMeasure(): void {
  if (!get(readingMeasureLimited)) {
    readingMeasureEm.set(READING_MEASURE_MAX);
    readingMeasureLimited.set(true);
    return;
  }
  readingMeasureEm.update((em) => clampMeasure(em - READING_MEASURE_STEP));
}

/** Aa 팝오버의 "리셋" — 글꼴·폭을 한 번에 기본값으로. */
export function resetReading(): void {
  resetFontSize();
  readingMeasureEm.set(READING_MEASURE_DEFAULT);
  readingMeasureLimited.set(true);
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

function loadMeasureEm(): number {
  try {
    const raw = localStorage.getItem(MEASURE_EM_KEY);
    if (raw) return clampMeasure(Number(raw));
  } catch (e) {
    // 미지원 — 기본값
  }
  return READING_MEASURE_DEFAULT;
}

function persistMeasureEm(em: number): void {
  try {
    localStorage.setItem(MEASURE_EM_KEY, String(em));
  } catch (e) {
    // 미지원 — 영속화 생략
  }
}
