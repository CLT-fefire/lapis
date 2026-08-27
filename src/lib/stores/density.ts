import { writable } from "svelte/store";

/**
 * 밀도 — **3단**(여유 · 기본 · 조밀).
 *
 * 순수 UI 선호라 백엔드 JSON SOT(`settings.ts`)가 아니라 localStorage 를 쓴다
 * (`theme.ts` 와 같은 패턴). `app.html` 의 인라인 스크립트가 first paint 전에
 * `data-density` 를 박아 레이아웃 점프를 막고, 여기서는 store 를 맞춰
 * `SettingsModal` 이 현재 값을 반영하게 한다.
 *
 * ## ⚠️ v2.0.0 은 2단이었고, 그 주석의 근거는 다른 것을 가리키고 있었다
 *
 * "Discord 는 3단을 넣고도 모든 단계가 조밀하면서 동시에 헐렁하다는 평을 받았다" —
 * 맞는 관찰이지만 그 평은 **간격 토큰이 반쪽만 움직였을 때** 나오는 것이지 단계 수의
 * 문제가 아니다. 3.0 은 `app.css` 의 `[data-density]` 블록 하나에서 전부 움직이고,
 * 글자 크기와 셸 치수는 밀도를 **따르지 않는다**(가독성과 OS 관례는 밀도의 대상이 아니다).
 */
export type Density = "cozy" | "default" | "compact";

/** 화면에 보이는 순서 — 여유에서 조밀로. */
export const DENSITIES = ["cozy", "default", "compact"] as const;

const DENSITY_KEY = "lapis.density";

export const density = writable<Density>("default");

/**
 * 저장값 → 밀도.
 *
 * ⚠️ **옛 값 둘(`default`·`compact`)은 그대로 유효하다.** 마이그레이션이 필요한 것은
 * 새로 생긴 `cozy` 뿐이다. 여기서 옛 값을 못 읽으면 조밀을 쓰던 사람이 조용히 기본으로
 * 되돌아간다.
 */
export function normalizeDensity(v: unknown): Density {
  return (DENSITIES as readonly unknown[]).includes(v) ? (v as Density) : "default";
}

function applyDensity(mode: Density): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.density = mode;
}

export function setDensity(mode: Density): void {
  density.set(mode);
  applyDensity(mode);
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DENSITY_KEY, mode);
  } catch {
    /* localStorage 사용 불가 — 무시 */
  }
}

/** 시동 시 1회 호출 — localStorage 값을 store + `data-density` 에 반영. */
export function restoreDensity(): void {
  if (typeof localStorage === "undefined") return;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(DENSITY_KEY);
  } catch {
    /* 무시 */
  }
  const mode = normalizeDensity(raw);
  density.set(mode);
  applyDensity(mode);
}
