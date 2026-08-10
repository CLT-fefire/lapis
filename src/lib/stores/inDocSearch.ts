import { writable, get } from "svelte/store";

export type SearchTarget = "editor" | "preview";

export interface InDocSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface InDocSearchState {
  open: boolean;
  target: SearchTarget;
  query: string;
  total: number;
  current: number; // 1-based; 0 = 매치 없음
  options: InDocSearchOptions;
  /** regex 모드에서 정규식 자체가 invalid한지. UI에서 빨간색 표시용. */
  regexError: boolean;
}

const DEFAULT_OPTIONS: InDocSearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

const STORAGE_KEY = "lapis.inDocSearch.options";

function loadOptions(): InDocSearchOptions {
  if (typeof localStorage === "undefined") return { ...DEFAULT_OPTIONS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_OPTIONS };
    const parsed = JSON.parse(raw) as Partial<InDocSearchOptions>;
    return {
      caseSensitive: Boolean(parsed.caseSensitive),
      wholeWord: Boolean(parsed.wholeWord),
      regex: Boolean(parsed.regex),
    };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

function saveOptions(opts: InDocSearchOptions): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(opts));
  } catch {
    // quota/private 모드 — 영속화 실패는 무시
  }
}

const initial: InDocSearchState = {
  open: false,
  target: "editor",
  query: "",
  total: 0,
  current: 0,
  options: loadOptions(),
  regexError: false,
};

export const inDocSearch = writable<InDocSearchState>(initial);

// `lastFocused`는 2026-08-10 split 제거와 함께 삭제됐다. Editor/Preview가 교대하므로
// "마지막으로 포커스된 영역" = 지금 떠 있는 영역 — ⌘F는 layout의 `mainPane`을 그대로 쓴다.

export function openSearch(target: SearchTarget): void {
  inDocSearch.update((s) => ({ ...s, open: true, target }));
}

export function closeSearch(): void {
  inDocSearch.update((s) => ({
    ...s,
    open: false,
    query: "",
    total: 0,
    current: 0,
    regexError: false,
  }));
}

export function setQuery(query: string): void {
  inDocSearch.update((s) => ({ ...s, query }));
}

export function setMatchInfo(total: number, current: number): void {
  inDocSearch.update((s) => ({ ...s, total, current }));
}

export function setRegexError(regexError: boolean): void {
  inDocSearch.update((s) => (s.regexError === regexError ? s : { ...s, regexError }));
}

export function toggleOption(key: keyof InDocSearchOptions): void {
  inDocSearch.update((s) => {
    const next = { ...s.options, [key]: !s.options[key] };
    saveOptions(next);
    return { ...s, options: next };
  });
}

/** 노트 전환 등 외부 이벤트로 검색 상태를 강제 초기화할 때 사용. options는 유지한다. */
export function resetSearch(): void {
  inDocSearch.update((s) => ({
    ...initial,
    options: s.options,
  }));
}

/** 현재 검색이 열려 있는지 + 어느 영역인지 빠르게 조회. */
export function isOpenFor(target: SearchTarget): boolean {
  const s = get(inDocSearch);
  return s.open && s.target === target;
}
