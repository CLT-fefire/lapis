import { get, writable } from "svelte/store";

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

/**
 * 현재 적용 중인 "실효 테마"(명/암)를 해석한다.
 * data-theme가 light/dark면 그대로, "system"(또는 미설정)이면 OS 선호를 따른다.
 * CSS는 토큰으로 자동 적응하지만, mermaid 등 JS로 렌더되는 자원은 이 값을 참조해야 한다.
 */
export function resolveEffectiveTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "dark";
  const attr = document.documentElement.dataset.theme;
  if (attr === "light") return "light";
  if (attr === "dark") return "dark";
  const prefersLight =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: light)").matches;
  return prefersLight ? "light" : "dark";
}

/**
 * "system" 모드에서 OS 외관(prefers-color-scheme) 변경을 구독한다.
 * light/dark 명시 모드는 OS 변경과 무관하므로 콜백을 부르지 않는다.
 * data-theme 속성은 "system" 그대로라 $themeMode 추적만으로는 감지 못 하고,
 * CSS는 prefers-color-scheme로 자동 적응하지만 mermaid처럼 JS로 baked되는
 * 자원은 이 시점에 명시적 재렌더가 필요하다. 반환값은 구독 해제 함수.
 */
export function onSystemThemeChange(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    if (get(themeMode) === "system") cb();
  };
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}

/** 시동 시 1회 호출 — localStorage 값을 store + data-theme에 반영. */
export function restoreTheme(): void {
  if (typeof localStorage === "undefined") return;
  const raw = localStorage.getItem(THEME_KEY);
  const mode: ThemeMode = isThemeMode(raw) ? raw : "system";
  themeMode.set(mode);
  applyTheme(mode);
}
