import { logQuery } from "$lib/stores/usage";
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
  /**
   * 🔴 **인계 일련번호** — `applySearch` 가 부를 때만 는다.
   *
   * 프리뷰 하이라이트는 "프리뷰 HTML 이 바뀔 때"만 다시 걸린다(그 이유는 `+page.svelte`
   * 의 effect 주석에). 그런데 `grep`·미완 작업에서 넘어올 때는 **본문이 먼저 그려지고
   * 질의가 나중에** 온다 — 그 순서에서는 하이라이트가 영영 안 걸린다. 실제로 안 걸렸다.
   *
   * ⚠️ 질의 전체를 반응 의존성으로 만들면 안 된다. `setMatchInfo` 가 스토어를 갱신하므로
   * 다음 일치로 넘어갈 때마다 effect 가 돌고 **현재 위치가 0 으로 되돌아간다.**
   * 그래서 인계에만 반응하는 번호를 따로 둔다.
   */
  handoff: number;
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
  handoff: 0,
};

export const inDocSearch = writable<InDocSearchState>(initial);

// `lastFocused`는 2026-08-10 split 제거와 함께 삭제됐다. Editor/Preview가 교대하므로
// "마지막으로 포커스된 영역" = 지금 떠 있는 영역 — ⌘F는 layout의 `mainPane`을 그대로 쓴다.

export function openSearch(target: SearchTarget): void {
  inDocSearch.update((s) => ({ ...s, open: true, target }));
}

/**
 * 질의와 옵션을 한 번에 지정하고 연다 — vault 전체 검색(`grep`) 결과에서 넘어올 때 쓴다.
 *
 * 결과를 클릭해 노트로 이동한 뒤 문서 맨 위에 떨구면 500줄짜리에서 찾은 걸 다시 찾아야
 * 한다. 같은 패턴·같은 옵션으로 문서 내 검색을 켜주면 그 자리가 바로 하이라이트된다.
 *
 * ⚠️ **옵션을 영속화하지 않는다.** `toggleOption`과 달리 localStorage에 쓰지 않는다.
 * 이건 한 번의 인계이지 사용자가 문서 내 검색에서 고른 취향이 아니다 — 덮어쓰면
 * 다음에 ⌘F를 열었을 때 남의 설정이 들어와 있다.
 */
export function applySearch(
  query: string,
  options: InDocSearchOptions,
  target: SearchTarget,
): void {
  inDocSearch.update((s) => ({
    ...s,
    open: true,
    target,
    query,
    options: { ...options },
    total: 0,
    current: 0,
    regexError: false,
    // ⚠️ 여기서만 는다 — 화면이 "인계가 왔다"를 이걸로 안다.
    handoff: s.handoff + 1,
  }));
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
  inDocSearch.update((s) => {
    /**
     * ⚠️ **질의당 한 번만 남긴다.** 이 함수는 타이핑 중에도, 다음 일치로 넘어갈 때도
     * 불린다. 부를 때마다 남기면 한 번의 검색이 로그에 수십 줄로 쌓여 "무엇을 자주
     * 찾나"의 답이 타자 속도를 재게 된다.
     */
    if (s.query !== "" && (s.query !== lastLogged || s.total !== total)) {
      lastLogged = s.query;
      logQuery("indoc", s.query, total);
    }
    return { ...s, total, current };
  });
}

/** 마지막으로 기록한 질의 — 같은 질의를 매 키 입력마다 다시 남기지 않기 위한 것. */
let lastLogged: string | null = null;

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
    // ⚠️ **번호는 안 되돌린다.** 0 으로 되돌리면 다음 인계가 "이미 본 번호"가 돼서
    //    조용히 무시된다. 단조 증가여야 한다.
    handoff: s.handoff,
  }));
}

/** 현재 검색이 열려 있는지 + 어느 영역인지 빠르게 조회. */
export function isOpenFor(target: SearchTarget): boolean {
  const s = get(inDocSearch);
  return s.open && s.target === target;
}
