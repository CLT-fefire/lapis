import { writable } from "svelte/store";

/**
 * 우측 컨텍스트 패널 — "현재 문서 주변"의 정보를 모은 아코디언 (2026-08-05 PR-4).
 *
 * Discord의 멤버 리스트 자리에 해당한다. 좌측 사이드바가 "vault 탐색"이라면 여기는
 * "이 문서에 딸린 것" — 속성(frontmatter) · 목차 · 관계/백링크 · 발행 자산.
 *
 * 패널 자체의 접힘은 `layout.contextCollapsed`가 담당하고, 여기는 **펼친 상태에서의
 * 섹션 아코디언**만 본다(sidebar.ts와 같은 2단 구조).
 */
export type ContextSectionKey = "properties" | "outline" | "relations" | "assets";

export const CONTEXT_SECTION_KEYS: readonly ContextSectionKey[] = [
  "properties",
  "outline",
  "relations",
  "assets",
] as const;

export type ContextSectionOpen = Record<ContextSectionKey, boolean>;

const STORAGE_KEY = "lapis.context-sections";

export function defaultContextSections(): ContextSectionOpen {
  // 첫 진입은 속성 + 관계만. 목차는 문서마다 길이 편차가 커 기본 접힘.
  return { properties: true, outline: false, relations: true, assets: false };
}

export function toggleContextSectionState(
  state: ContextSectionOpen,
  key: ContextSectionKey,
): ContextSectionOpen {
  return { ...state, [key]: !state[key] };
}

export function ensureContextSectionOpenState(
  state: ContextSectionOpen,
  key: ContextSectionKey,
): ContextSectionOpen {
  if (state[key]) return state;
  return { ...state, [key]: true };
}

function load(): ContextSectionOpen {
  const d = defaultContextSections();
  if (typeof localStorage === "undefined") return d;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return d;
    const parsed = JSON.parse(raw) as Partial<ContextSectionOpen>;
    // 키 누락/추가 방어 — 기본 위에 저장값 병합.
    return { ...d, ...parsed };
  } catch {
    return d;
  }
}

export const contextSections = writable<ContextSectionOpen>(load());

contextSections.subscribe((s) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* localStorage 사용 불가(테스트 stub 등) — 무시 */
  }
});

export function toggleContextSection(key: ContextSectionKey): void {
  contextSections.update((s) => toggleContextSectionState(s, key));
}

export function ensureContextSectionOpen(key: ContextSectionKey): void {
  contextSections.update((s) => ensureContextSectionOpenState(s, key));
}
