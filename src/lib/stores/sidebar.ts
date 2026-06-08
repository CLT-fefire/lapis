import { writable } from "svelte/store";

/**
 * 사이드바 세로 아코디언 — 각 섹션 펼침/접힘 상태 (옵션 B, brainstorm sidebar-vertical-nav).
 *
 * 가로 탭(구 `sidebarTab`, 배타 선택)을 대체. 5섹션을 세로로 쌓고 **각각 개별 접기/펼치기**
 * (여러 개 동시 펼침 가능). 순수 reducer(vitest) + localStorage 영속.
 *
 * "접힘=아이콘 레일"은 별도 레벨로 `layout.sidebarCollapsed`(⌘B·SidebarRail)가 담당 —
 * 여기는 펼침 상태에서의 섹션 아코디언만.
 */
export type SidebarSectionKey = "files" | "outline" | "tags" | "filters" | "favorites";

export const SECTION_KEYS: readonly SidebarSectionKey[] = [
  "files",
  "outline",
  "tags",
  "filters",
  "favorites",
] as const;

export interface SidebarNavState {
  /** 각 섹션 펼침 여부. */
  sectionOpen: Record<SidebarSectionKey, boolean>;
}

const STORAGE_KEY = "lapis.sidebar-sections";

export function defaultSidebarNav(): SidebarNavState {
  return {
    // 첫 진입은 파일 트리만 펼침(주 콘텐츠).
    sectionOpen: { files: true, outline: false, tags: false, filters: false, favorites: false },
  };
}

/** 섹션 개별 접기/펼치기 토글. */
export function toggleSectionState(
  state: SidebarNavState,
  key: SidebarSectionKey,
): SidebarNavState {
  return { sectionOpen: { ...state.sectionOpen, [key]: !state.sectionOpen[key] } };
}

/** 해당 섹션이 펼쳐지도록 보장(다른 섹션은 유지). 이미 열려 있으면 no-op. */
export function ensureSectionOpenState(
  state: SidebarNavState,
  key: SidebarSectionKey,
): SidebarNavState {
  if (state.sectionOpen[key]) return state;
  return { sectionOpen: { ...state.sectionOpen, [key]: true } };
}

// === store (localStorage 영속) ===

function loadSidebarNav(): SidebarNavState {
  const d = defaultSidebarNav();
  if (typeof localStorage === "undefined") return d;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return d;
    const parsed = JSON.parse(raw) as Partial<SidebarNavState>;
    // 키 누락/추가 방어 — 기본 위에 저장값 병합.
    return { sectionOpen: { ...d.sectionOpen, ...(parsed.sectionOpen ?? {}) } };
  } catch {
    return d;
  }
}

export const sidebarNav = writable<SidebarNavState>(loadSidebarNav());

sidebarNav.subscribe((s) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* localStorage 사용 불가(테스트 stub 등) — 무시 */
  }
});

export function toggleSection(key: SidebarSectionKey): void {
  sidebarNav.update((s) => toggleSectionState(s, key));
}

export function ensureSectionOpen(key: SidebarSectionKey): void {
  sidebarNav.update((s) => ensureSectionOpenState(s, key));
}
