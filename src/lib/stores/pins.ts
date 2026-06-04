import { writable, get } from "svelte/store";

const PINNED_KEY = "lapis.pinned-notes";

/**
 * 핀(즐겨찾기) 노트 path 목록. 가장 최근에 핀한 것이 앞.
 * localStorage 영속(전역) — vault 전환 시 지우지 않고, 표시 측에서 현재 vault에
 * 존재하는 path만 필터한다(FavoritesPanel).
 */
export const pinnedNotePaths = writable<string[]>(loadPinned());

pinnedNotePaths.subscribe(persistPinned);

/** 핀 토글 — 있으면 제거, 없으면 맨 앞에 추가. */
export function togglePinEntry(pins: string[], path: string): string[] {
  if (!path) return pins;
  if (pins.includes(path)) return pins.filter((p) => p !== path);
  return [path, ...pins];
}

/** 핀 제거 — 없으면 그대로. */
export function removePinEntry(pins: string[], path: string): string[] {
  if (!pins.includes(path)) return pins;
  return pins.filter((p) => p !== path);
}

export function togglePin(path: string): void {
  pinnedNotePaths.update((pins) => togglePinEntry(pins, path));
}

export function removePin(path: string): void {
  pinnedNotePaths.update((pins) => removePinEntry(pins, path));
}

export function isPinned(path: string): boolean {
  return get(pinnedNotePaths).includes(path);
}

// === localStorage helpers ===

// localStorage 미지원/비정상 환경(vitest stub 등)에서도 안전하도록 try/catch.
function loadPinned(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.every((x) => typeof x === "string")) {
      return arr;
    }
  } catch (e) {
    // localStorage 미지원 또는 파싱 실패 — 빈 목록으로 시작
  }
  return [];
}

function persistPinned(list: string[]): void {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(list));
  } catch (e) {
    // localStorage 미지원 — 영속화 생략
  }
}
