import { writable, derived } from "svelte/store";

/**
 * 노트 방문 순서 스택 + 현재 위치 커서. 브라우저/Xcode식 뒤로·앞으로 가기.
 * recent(MRU 빈도)·lastClosed(직전 1개)와는 별개 — 방문 순서를 보존한다.
 */
export interface NavState {
  /** 방문 순서 path 스택(과거→미래). */
  entries: string[];
  /** 현재 위치 인덱스. 비어 있으면 -1. */
  cursor: number;
}

export const EMPTY_NAV: NavState = { entries: [], cursor: -1 };

/** 히스토리 최대 길이. path 문자열이라 비용은 무시 가능. */
export const NAV_LIMIT = 50;

/**
 * 새 노트 방문 기록. cursor 이후(forward 분기)를 버리고 path를 push한다.
 * - 현재 위치와 동일 path면 변화 없음(재방문).
 * - limit 초과 시 앞(가장 오래된)에서 잘라내며 cursor 보정.
 */
export function pushEntry(state: NavState, path: string, limit: number): NavState {
  if (!path) return state;
  if (state.cursor >= 0 && state.entries[state.cursor] === path) return state;
  const head = state.entries.slice(0, state.cursor + 1);
  head.push(path);
  const overflow = Math.max(0, head.length - limit);
  const entries = overflow > 0 ? head.slice(overflow) : head;
  return { entries, cursor: entries.length - 1 };
}

/** 한 칸 뒤로(과거). 맨 앞이면 변화 없음. */
export function goBack(state: NavState): NavState {
  if (state.cursor <= 0) return state;
  return { ...state, cursor: state.cursor - 1 };
}

/** 한 칸 앞으로(미래). 맨 끝이면 변화 없음. */
export function goForward(state: NavState): NavState {
  if (state.cursor >= state.entries.length - 1) return state;
  return { ...state, cursor: state.cursor + 1 };
}

/** 현재 위치의 path. 비어 있으면 null. */
export function currentPath(state: NavState): string | null {
  return state.cursor >= 0 ? state.entries[state.cursor] : null;
}

export function canBack(state: NavState): boolean {
  return state.cursor > 0;
}

export function canForward(state: NavState): boolean {
  return state.cursor < state.entries.length - 1;
}

// === store (세션성 — localStorage 영속화 X) ===

const navState = writable<NavState>(EMPTY_NAV);

export const canGoBack = derived(navState, canBack);
export const canGoForward = derived(navState, canForward);

/** 새 노트 방문 기록(뒤로/앞으로가 아닌 일반 열기). */
export function recordNavigation(path: string): void {
  navState.update((s) => pushEntry(s, path, NAV_LIMIT));
}

/** 뒤로 이동 후 새 현재 path 반환(없으면 null). */
export function navBack(): string | null {
  let result: string | null = null;
  navState.update((s) => {
    const next = goBack(s);
    result = currentPath(next);
    return next;
  });
  return result;
}

/** 앞으로 이동 후 새 현재 path 반환(없으면 null). */
export function navForward(): string | null {
  let result: string | null = null;
  navState.update((s) => {
    const next = goForward(s);
    result = currentPath(next);
    return next;
  });
  return result;
}

/** vault 전환 시 초기화. */
export function clearNavHistory(): void {
  navState.set(EMPTY_NAV);
}
