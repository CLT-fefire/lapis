import { writable, get } from "svelte/store";
import { logWarn } from "$lib/stores/usage";

// `lastClosedNotePath` / `lapis.last-closed-note`는 2026-08-10에 제거됐다.
// ⌘⇧T(닫은 노트 복원)가 사라지면서 유일한 소비자가 없어졌고, 방문 순서 이동은
// navHistory(⌘⌃←/→ · ⌘,/⌘.)가 더 잘 한다.
const RECENT_KEY = "lapis.recent-notes";

export const RECENT_LIMIT = 30;
export const RECENT_DISPLAY = 5;

export const recentNotePaths = writable<string[]>(loadRecent());

recentNotePaths.subscribe(persistRecent);

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
 * RECENT 그룹 표시용 — 디스크에 없는 path는 호출자가 필터링. 여기선 단순히 슬라이스.
 */
export function getRecentDisplay(limit: number = RECENT_DISPLAY): string[] {
  return get(recentNotePaths).slice(0, limit);
}

/** vault 전환 시 호출 — 다른 vault의 path는 노출하지 않도록 정리. (현재는 비사용, 표시 시 필터 권장) */
export function clearRecent(): void {
  recentNotePaths.set([]);
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
    logWarn("stores/recent", "loadRecent failed", e);
  }
  localStorage.removeItem(RECENT_KEY);
  return [];
}

function persistRecent(list: string[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}
