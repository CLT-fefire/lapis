import { writable, get } from "svelte/store";

const RECENT_KEY = "lapis.recent-notes";
const LAST_CLOSED_KEY = "lapis.last-closed-note";

export const RECENT_LIMIT = 30;
export const RECENT_DISPLAY = 5;

export const recentNotePaths = writable<string[]>(loadRecent());
/** 직전에 열려 있던 노트 path. Cmd+Shift+T로 다시 열 때 사용. */
export const lastClosedNotePath = writable<string | null>(loadLastClosed());

recentNotePaths.subscribe(persistRecent);
lastClosedNotePath.subscribe(persistLastClosed);

/**
 * 사용자가 노트를 연 직후 호출. 같은 path는 맨 앞으로 끌어올리고 중복 제거.
 * RECENT_LIMIT 초과분은 끝에서 잘라낸다.
 */
export function pushRecent(path: string): void {
  if (!path) return;
  recentNotePaths.update((list) => {
    const filtered = list.filter((p) => p !== path);
    return [path, ...filtered].slice(0, RECENT_LIMIT);
  });
}

/**
 * 새 노트로 전환 직전에, 현재 열려 있던 노트 path를 lastClosed로 기록.
 * - null → null 갱신 (vault 닫힘 등)
 * - 같은 path를 중복 기록하지 않음
 */
export function rememberLastClosed(path: string | null): void {
  if (path === get(lastClosedNotePath)) return;
  lastClosedNotePath.set(path);
}

/**
 * Cmd+Shift+T 동작 — lastClosed를 한 번 소비하고 반환. 같은 노트를 두 번 reopen
 * 못 하도록 자체 토글은 호출자가 결정. (현재는 그대로 둔다 → 다음 ⌘⇧T로 다시 토글)
 */
export function peekLastClosed(): string | null {
  return get(lastClosedNotePath);
}

/**
 * RECENT 그룹 표시용 — 디스크에 없는 path는 호출자가 필터링. 여기선 단순히 슬라이스.
 */
export function getRecentDisplay(limit: number = RECENT_DISPLAY): string[] {
  return get(recentNotePaths).slice(0, limit);
}

/** vault 전환 시 호출 — 다른 vault의 path는 노출하지 않도록 정리. (현재는 비사용, 표시 시 필터 권장) */
export function clearRecent(): void {
  recentNotePaths.set([]);
  lastClosedNotePath.set(null);
}

// === localStorage helpers ===

function loadRecent(): string[] {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(RECENT_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.every((x) => typeof x === "string")) {
      return arr.slice(0, RECENT_LIMIT);
    }
  } catch (e) {
    console.warn("loadRecent failed", e);
  }
  localStorage.removeItem(RECENT_KEY);
  return [];
}

function loadLastClosed(): string | null {
  if (typeof localStorage === "undefined") return null;
  const v = localStorage.getItem(LAST_CLOSED_KEY);
  return v && v.length > 0 ? v : null;
}

function persistRecent(list: string[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

function persistLastClosed(path: string | null): void {
  if (typeof localStorage === "undefined") return;
  if (path) localStorage.setItem(LAST_CLOSED_KEY, path);
  else localStorage.removeItem(LAST_CLOSED_KEY);
}
