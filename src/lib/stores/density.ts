import { writable } from "svelte/store";

// 밀도는 순수 UI 선호 → 백엔드 JSON SOT(settings.ts)가 아닌 localStorage 사용(theme.ts와 동일 패턴).
// app.html의 인라인 스크립트가 first-paint 전에 data-density를 적용(레이아웃 점프 방지)하고,
// 여기서는 store를 동기화해 SettingsModal UI가 현재 밀도를 반영하도록 한다.
//
// 2단만 둔다(default / compact). Discord는 3단(compact/default/spacious)을 넣고도
// "모든 단계가 조밀하면서 동시에 헐렁하다"는 평을 받았다 — 12,000+ 노트를 다루는
// Lapis에서 spacious는 탐색 비용만 키운다.
export type Density = "default" | "compact";

const DENSITY_KEY = "lapis.density";

export const density = writable<Density>("default");

function isDensity(v: unknown): v is Density {
  return v === "default" || v === "compact";
}

function applyDensity(mode: Density): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.density = mode;
}

export function setDensity(mode: Density): void {
  density.set(mode);
  applyDensity(mode);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(DENSITY_KEY, mode);
  }
}

/** 시동 시 1회 호출 — localStorage 값을 store + data-density에 반영. */
export function restoreDensity(): void {
  if (typeof localStorage === "undefined") return;
  const raw = localStorage.getItem(DENSITY_KEY);
  const mode: Density = isDensity(raw) ? raw : "default";
  density.set(mode);
  applyDensity(mode);
}
