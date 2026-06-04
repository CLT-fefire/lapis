import { writable } from "svelte/store";

/**
 * 열린 노트 탭 목록. 활성 탭은 vault의 `currentNotePath`가 그대로 담당하고,
 * 이 store는 "열려 있는 path 집합(순서 보존)"만 얇게 얹는다.
 * 비영속(세션성) — vault 전환 시 초기화.
 */
export const openTabs = writable<string[]>([]);

/** 탭 추가 — 이미 있으면 그대로, 없으면 끝에 추가. */
export function addTabEntry(tabs: string[], path: string): string[] {
  if (!path || tabs.includes(path)) return tabs;
  return [...tabs, path];
}

/**
 * 탭 제거 + 다음 활성 path 계산.
 * - 활성 탭을 닫으면: 오른쪽 우선(없으면 왼쪽) 인접 탭, 빈 목록이면 null.
 * - 비활성 탭을 닫으면: activePath 유지.
 * - 목록에 없으면: 변화 없음.
 */
export function removeTabEntry(
  tabs: string[],
  path: string,
  activePath: string | null,
): { tabs: string[]; nextActive: string | null } {
  const idx = tabs.indexOf(path);
  if (idx === -1) return { tabs, nextActive: activePath };

  const next = tabs.filter((p) => p !== path);
  if (path !== activePath) return { tabs: next, nextActive: activePath };

  // 활성 탭을 닫음 — 같은 위치(오른쪽) 또는 마지막(왼쪽) 탭으로.
  const nextActive = next.length > 0 ? next[Math.min(idx, next.length - 1)] : null;
  return { tabs: next, nextActive };
}

/** 노트 열기 시 호출 — 탭 등록. */
export function registerTab(path: string): void {
  openTabs.update((tabs) => addTabEntry(tabs, path));
}

/** 탭 제거 후 다음 활성 path 반환(없으면 null). activePath는 호출자가 전달. */
export function unregisterTab(path: string, activePath: string | null): string | null {
  let nextActive: string | null = activePath;
  openTabs.update((tabs) => {
    const result = removeTabEntry(tabs, path, activePath);
    nextActive = result.nextActive;
    return result.tabs;
  });
  return nextActive;
}

/**
 * Cmd+1~9 단축키 → 활성화할 탭 path.
 * - 1~9: 해당 번째(1-based) 탭. 탭 수보다 크면 null.
 * - 그 외/빈 목록: null.
 */
export function tabPathForShortcut(tabs: string[], digit: number): string | null {
  if (digit >= 1 && digit <= 9) return tabs[digit - 1] ?? null;
  return null;
}

/** vault 전환 시 초기화. */
export function clearTabs(): void {
  openTabs.set([]);
}
