import { writable, get } from "svelte/store";

export type SearchTarget = "editor" | "preview";

export interface InDocSearchState {
  open: boolean;
  target: SearchTarget;
  query: string;
  total: number;
  current: number; // 1-based; 0 = 매치 없음
}

const initial: InDocSearchState = {
  open: false,
  target: "editor",
  query: "",
  total: 0,
  current: 0,
};

export const inDocSearch = writable<InDocSearchState>(initial);

/**
 * 마지막으로 포커스된 영역. Cmd+F가 어디로 갈지 결정한다.
 * Editor 포커스 시 'editor', Preview 영역 mousedown/focusin 시 'preview'.
 */
export const lastFocused = writable<SearchTarget>("editor");

export function openSearch(target: SearchTarget): void {
  inDocSearch.update((s) => ({ ...s, open: true, target }));
}

export function closeSearch(): void {
  inDocSearch.update((s) => ({ ...s, open: false, query: "", total: 0, current: 0 }));
}

export function setQuery(query: string): void {
  inDocSearch.update((s) => ({ ...s, query }));
}

export function setMatchInfo(total: number, current: number): void {
  inDocSearch.update((s) => ({ ...s, total, current }));
}

/** 노트 전환 등 외부 이벤트로 검색 상태를 강제 초기화할 때 사용. */
export function resetSearch(): void {
  inDocSearch.set(initial);
}

/** 현재 검색이 열려 있는지 + 어느 영역인지 빠르게 조회. */
export function isOpenFor(target: SearchTarget): boolean {
  const s = get(inDocSearch);
  return s.open && s.target === target;
}
