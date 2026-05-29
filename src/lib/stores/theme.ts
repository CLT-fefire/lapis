import { writable } from "svelte/store";

// 테마는 순수 UI 선호 → 백엔드 JSON SOT(settings.ts)가 아닌 localStorage 사용.
// app.html의 인라인 스크립트가 first-paint 전에 data-theme를 읽어 적용(FOUC 방지)하고,
// 여기서는 store를 동기화해 SettingsModal UI가 현재 모드를 반영하도록 한다.
export type ThemeMode = "light" | "dark" | "system";

const THEME_KEY = "lapis.theme";

export const themeMode = writable<ThemeMode>("system");

function isThemeMode(v: unknown): v is ThemeMode {
  return v === "light" || v === "dark" || v === "system";
}

function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = mode;
}

export function setTheme(mode: ThemeMode): void {
  themeMode.set(mode);
  applyTheme(mode);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(THEME_KEY, mode);
  }
}

/** 시동 시 1회 호출 — localStorage 값을 store + data-theme에 반영. */
export function restoreTheme(): void {
  if (typeof localStorage === "undefined") return;
  const raw = localStorage.getItem(THEME_KEY);
  const mode: ThemeMode = isThemeMode(raw) ? raw : "system";
  themeMode.set(mode);
  applyTheme(mode);
}
