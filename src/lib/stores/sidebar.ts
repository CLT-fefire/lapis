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
// "outline"은 2026-08-05(PR-4)에 우측 컨텍스트 패널로 이전 — context.ts 소관.
// 사이드바는 "vault 탐색", 컨텍스트 패널은 "현재 문서에 딸린 것"으로 역할이 갈린다.
export type SidebarSectionKey = "files" | "tags" | "filters" | "favorites";

export const SECTION_KEYS: readonly SidebarSectionKey[] = [
  "files",
  "tags",
  "filters",
  "favorites",
] as const;

export interface SidebarNavState {
  /** 각 섹션 펼침 여부. */
  sectionOpen: Record<SidebarSectionKey, boolean>;
  /**
   * 각 섹션의 고정 높이(px). null = 미설정 → 가용 공간 균등 분배(flex). 사용자가 리사이즈
   * 핸들을 드래그한 섹션만 고정 px로 전환. 마지막 펼친 섹션은 항상 잔여 공간을 흡수(null 취급).
   */
  sectionHeights: Record<SidebarSectionKey, number | null>;
}

const STORAGE_KEY = "lapis.sidebar-sections";

/** 리사이즈 높이 클램프 — 너무 작아 헤더만 남거나 과도하게 커지는 것 방지. */
export const MIN_SECTION_HEIGHT = 72;
export const MAX_SECTION_HEIGHT = 900;

export function defaultSidebarNav(): SidebarNavState {
  return {
    // 첫 진입은 파일 트리만 펼침(주 콘텐츠).
    sectionOpen: { files: true, tags: false, filters: false, favorites: false },
    // 전부 미설정 — 첫 펼침은 균등 분배(기존 동작).
    sectionHeights: { files: null, tags: null, filters: null, favorites: null },
  };
}

/** 섹션 개별 접기/펼치기 토글. */
export function toggleSectionState(
  state: SidebarNavState,
  key: SidebarSectionKey,
): SidebarNavState {
  return {
    ...state,
    sectionOpen: { ...state.sectionOpen, [key]: !state.sectionOpen[key] },
  };
}

/** 해당 섹션이 펼쳐지도록 보장(다른 섹션은 유지). 이미 열려 있으면 no-op. */
export function ensureSectionOpenState(
  state: SidebarNavState,
  key: SidebarSectionKey,
): SidebarNavState {
  if (state.sectionOpen[key]) return state;
  return { ...state, sectionOpen: { ...state.sectionOpen, [key]: true } };
}

/**
 * 섹션 고정 높이 설정(px) — 리사이즈 핸들 드래그 결과. null이면 미설정(균등 분배)으로 복귀.
 * px는 [MIN, MAX]로 클램프. 다른 섹션 높이는 유지.
 */
export function setSectionHeightState(
  state: SidebarNavState,
  key: SidebarSectionKey,
  height: number | null,
): SidebarNavState {
  const clamped =
    height == null
      ? null
      : Math.max(MIN_SECTION_HEIGHT, Math.min(MAX_SECTION_HEIGHT, Math.round(height)));
  return { ...state, sectionHeights: { ...state.sectionHeights, [key]: clamped } };
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
    return {
      sectionOpen: { ...d.sectionOpen, ...(parsed.sectionOpen ?? {}) },
      sectionHeights: { ...d.sectionHeights, ...(parsed.sectionHeights ?? {}) },
    };
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

/** 섹션 고정 높이 설정(px, null=균등 복귀). 리사이즈 핸들 드래그/더블클릭에서 호출. */
export function setSectionHeight(key: SidebarSectionKey, height: number | null): void {
  sidebarNav.update((s) => setSectionHeightState(s, key, height));
}
