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

/** from 위치의 탭을 to 위치로 이동(드래그 재정렬). 범위 밖/동일이면 그대로. */
export function reorderTabs(tabs: string[], from: number, to: number): string[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= tabs.length ||
    to >= tabs.length
  ) {
    return tabs;
  }
  const next = [...tabs];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** path만 남기고 모두 제거(다른 탭 닫기). path가 없으면 그대로. */
export function closeOthers(tabs: string[], path: string): string[] {
  return tabs.includes(path) ? [path] : tabs;
}

/** path까지 유지하고 오른쪽 전부 제거(오른쪽 탭 닫기). path가 없으면 그대로. */
export function keepUpTo(tabs: string[], path: string): string[] {
  const idx = tabs.indexOf(path);
  return idx === -1 ? tabs : tabs.slice(0, idx + 1);
}

/** vault 전환 시 초기화. */
export function clearTabs(): void {
  openTabs.set([]);
}

// === vault별 영속화 (localStorage) ===

const TABS_KEY = "lapis.open-tabs";

/** vault path → 열린 탭 + 활성 노트. */
export interface VaultTabs {
  tabs: string[];
  active: string | null;
}
export type TabsMap = Record<string, VaultTabs>;

/** 맵에서 특정 vault의 탭 상태 읽기(없으면 빈 상태). 순수. */
export function readVaultTabs(map: TabsMap, vaultPath: string): VaultTabs {
  return map[vaultPath] ?? { tabs: [], active: null };
}

/** 맵에 특정 vault의 탭 상태를 갱신한 새 맵 반환. 순수. */
export function upsertVaultTabs(
  map: TabsMap,
  vaultPath: string,
  tabs: string[],
  active: string | null,
): TabsMap {
  return { ...map, [vaultPath]: { tabs, active } };
}

// localStorage 래퍼 — 미지원/비정상 환경(vitest stub 등)에서도 안전하도록 try/catch.
function loadTabsMap(): TabsMap {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as TabsMap;
  } catch (e) {
    // 미지원/파싱 실패 — 빈 맵
  }
  return {};
}

function saveTabsMap(map: TabsMap): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(map));
  } catch (e) {
    // 미지원 — 영속화 생략
  }
}

/** 특정 vault의 저장된 탭 상태 로드. */
export function loadTabsFor(vaultPath: string): VaultTabs {
  return readVaultTabs(loadTabsMap(), vaultPath);
}

/** 특정 vault의 탭 상태 저장(다른 vault 항목은 보존). */
export function saveTabsFor(vaultPath: string, tabs: string[], active: string | null): void {
  if (!vaultPath) return;
  saveTabsMap(upsertVaultTabs(loadTabsMap(), vaultPath, tabs, active));
}
