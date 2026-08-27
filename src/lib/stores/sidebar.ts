import { writable } from "svelte/store";

/**
 * 사이드바 — **한 번에 한 뷰**.
 *
 * ## ⚠️ 아코디언에서 왜 바꿨나
 *
 * v2.0.0 은 섹션 넷을 세로로 쌓고 각각 개별로 접었다(여러 개 동시 펼침 + 높이 드래그).
 * 260px 폭에 넷을 나눠 담으니 **어느 것도 제 높이를 못 가졌고**, 높이 드래그는 그 문제를
 * 사용자에게 떠넘기는 장치였다.
 *
 * 3.0 은 레일이 뷰를 **고르고** 사이드바는 그 하나를 온전히 보여준다(VS Code 액티비티 바).
 * 폭은 그대로인데 세로가 넷에서 하나로 줄어드니 목록이 실제로 읽힌다.
 *
 * ⚠️ **`sectionHeights` 와 그 리듀서는 버린다.** 뷰가 하나면 나눌 높이가 없다. 저장돼 있던
 * 값은 마이그레이션에서 조용히 사라지는데, 그건 의미를 잃은 값이지 잃어버린 설정이 아니다.
 */

/** 레일이 고를 수 있는 뷰. 순서가 레일의 세로 순서다. */
export type SidebarViewKey =
  | "files"
  | "tags"
  | "filters"
  | "favorites"
  | "table"
  | "hygiene";

export const VIEW_KEYS: readonly SidebarViewKey[] = [
  "files",
  "tags",
  "filters",
  "favorites",
  "table",
  "hygiene",
] as const;

export interface SidebarNavState {
  /**
   * 지금 보고 있는 뷰. `null` 이면 접힘(레일만 남는다).
   *
   * ⚠️ `layout.sidebarCollapsed` 와 **다른 것**이다. 저쪽은 "패널을 접었나"이고 이쪽은
   * "무엇을 보고 있나"다. 레일에서 활성 아이콘을 다시 누르면 둘 다 접힘으로 간다.
   */
  activeView: SidebarViewKey;
}

const STORAGE_KEY = "lapis.sidebar-sections";

export function defaultSidebarNav(): SidebarNavState {
  return { activeView: "files" };
}

/** 옛 아코디언 상태의 모양 — 마이그레이션에서만 쓴다. */
interface LegacyNavState {
  sectionOpen?: Partial<Record<string, boolean>>;
}

/**
 * 저장된 상태 → 새 상태.
 *
 * ⚠️ **열려 있던 첫 섹션을 고른다.** 아무거나 고르면 사용자가 보던 것과 다른 화면으로
 * 열리고, 그건 "설정이 날아갔다"로 읽힌다. 전부 닫혀 있었으면 파일 트리다.
 */
export function migrateSidebarNav(raw: unknown): SidebarNavState {
  const d = defaultSidebarNav();
  if (!raw || typeof raw !== "object") return d;

  const asNew = raw as Partial<SidebarNavState>;
  if (typeof asNew.activeView === "string" && VIEW_KEYS.includes(asNew.activeView)) {
    return { activeView: asNew.activeView };
  }

  const legacy = raw as LegacyNavState;
  if (legacy.sectionOpen) {
    const first = VIEW_KEYS.find((k) => legacy.sectionOpen?.[k] === true);
    if (first) return { activeView: first };
  }
  return d;
}

// === store (localStorage 영속) ===

function loadSidebarNav(): SidebarNavState {
  if (typeof localStorage === "undefined") return defaultSidebarNav();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return migrateSidebarNav(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultSidebarNav();
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

/** 그 뷰로 전환한다. 이미 그 뷰면 아무 일도 없다 — 접기는 호출부가 판단한다. */
export function showView(key: SidebarViewKey): void {
  sidebarNav.update((s) => (s.activeView === key ? s : { activeView: key }));
}
