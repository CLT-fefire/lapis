import { writable, get } from "svelte/store";
import { logWarn } from "$lib/stores/usage";

const PANE_KEY = "lapis.pane-state";
const SIDEBAR_WIDTH_KEY = "lapis.sidebar-width";
const SIDEBAR_COLLAPSED_KEY = "lapis.sidebar-collapsed";
const CONTEXT_WIDTH_KEY = "lapis.context-width";

export const DEFAULT_SIDEBAR_WIDTH = 260;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 600;

export const DEFAULT_CONTEXT_WIDTH = 300;
export const MIN_CONTEXT_WIDTH = 220;
export const MAX_CONTEXT_WIDTH = 520;

/**
 * 본문 영역에 무엇을 띄울지 — Editor와 Preview는 **교대**한다(split 없음, 2026-08-10).
 *
 * 이전 모델은 `editorCollapsed`/`previewCollapsed` 2비트였는데, "둘 다 접힘"이
 * 불법이라 토글·헤더 버튼·복원 세 곳에 가드가 붙어 있었다 — 즉 실제 상태는
 * 처음부터 enum 하나였다. split을 걷어내면서 그 가드가 통째로 사라진다.
 */
export type MainPane = "preview" | "editor";

export const mainPane = writable<MainPane>("preview");
export const sidebarCollapsed = writable<boolean>(false);
export const sidebarWidth = writable<number>(DEFAULT_SIDEBAR_WIDTH);
/** 우측 컨텍스트 패널(관계·백링크·목차·속성). 본문 페인과 **독립**으로 접힌다. */
export const contextCollapsed = writable<boolean>(false);
export const contextWidth = writable<number>(DEFAULT_CONTEXT_WIDTH);

export function toggleSidebar(): void {
  sidebarCollapsed.update((v) => !v);
  persistSidebarCollapsed();
}

/** 접혀 있으면(아이콘 레일) 펼침. 펼쳐 있으면 no-op. */
export function expandSidebar(): void {
  if (get(sidebarCollapsed)) {
    sidebarCollapsed.set(false);
    persistSidebarCollapsed();
  }
}

/**
 * 펼쳐 있으면 접음. 접혀 있으면 no-op.
 *
 * ⚠️ `toggleSidebar` 와 다르다. 레일의 **활성 아이콘 재클릭**은 "접어라"이지 "뒤집어라"가
 * 아니다 — 접힌 상태에서 그 아이콘을 누르면 펼쳐지는 것이 맞고, 토글이면 그게 안 된다.
 */
export function collapseSidebar(): void {
  if (!get(sidebarCollapsed)) {
    sidebarCollapsed.set(true);
    persistSidebarCollapsed();
  }
}

/** 읽기 ↔ 편집 교대. 가드가 필요 없다 — 어느 쪽이든 항상 하나는 떠 있다. */
export function toggleMainPane(): void {
  mainPane.update((v) => (v === "preview" ? "editor" : "preview"));
  persistPane();
}

export function setMainPane(pane: MainPane): void {
  if (get(mainPane) === pane) return;
  mainPane.set(pane);
  persistPane();
}

/** 컨텍스트 패널은 본문 페인 모드와 무관하게 언제든 접고 펼 수 있다. */
export function toggleContext(): void {
  contextCollapsed.update((v) => !v);
  persistPane();
}

/** 접혀 있으면 펼침. 펼쳐 있으면 no-op (expandSidebar와 같은 어휘). */
export function expandContext(): void {
  if (get(contextCollapsed)) {
    contextCollapsed.set(false);
    persistPane();
  }
}

function clampWidth(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(px)));
}

function clampContextWidth(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_CONTEXT_WIDTH;
  return Math.max(MIN_CONTEXT_WIDTH, Math.min(MAX_CONTEXT_WIDTH, Math.round(px)));
}

export function setSidebarWidth(px: number): void {
  const clamped = clampWidth(px);
  sidebarWidth.set(clamped);
  persistSidebarWidth(clamped);
}

export function resetSidebarWidth(): void {
  setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
}

export function setContextWidth(px: number): void {
  const clamped = clampContextWidth(px);
  contextWidth.set(clamped);
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CONTEXT_WIDTH_KEY, String(clamped));
}

export function resetContextWidth(): void {
  setContextWidth(DEFAULT_CONTEXT_WIDTH);
}

/**
 * 모든 페인 상태·폭을 기본값으로 되돌린다(⌘K → "레이아웃 초기화").
 * 신규 설치 기본값과 동일한 상태 — 기존 사용자가 원할 때 스스로 맞출 수 있는 경로다.
 */
export function resetLayout(): void {
  mainPane.set("preview");
  contextCollapsed.set(false);
  sidebarCollapsed.set(false);
  persistPane();
  persistSidebarCollapsed();
  setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  setContextWidth(DEFAULT_CONTEXT_WIDTH);
}

function persistPane(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    PANE_KEY,
    JSON.stringify({
      pane: get(mainPane),
      context: get(contextCollapsed),
    }),
  );
}

function persistSidebarWidth(px: number): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SIDEBAR_WIDTH_KEY, String(px));
}

function persistSidebarCollapsed(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(get(sidebarCollapsed)));
}

/**
 * 저장값 → mainPane. 구 스키마(`{editor, preview}` boolean 2개)를 함께 받는다.
 *
 * 접기 2비트에는 `split`(둘 다 펼침)이 있었지만 새 모델엔 없다 — split이던 사용자는
 * **읽기**로 보낸다. 신규 설치·레이아웃 초기화와 같은 쪽이라 결과가 한 곳으로 수렴하고,
 * Lapis의 주 용도(읽기·탐색)와도 맞는다. 편집을 쓰던 사용자만 `editor`로 남는다.
 */
function readMainPane(parsed: Record<string, unknown>): MainPane {
  if (parsed.pane === "editor" || parsed.pane === "preview") return parsed.pane;
  // 구 스키마: 프리뷰만 접혀 있었다 = 편집을 보고 있었다.
  // (둘 다 접힘은 옛 가드가 막던 손상 상태 — 여기선 조용히 읽기로 떨군다.)
  if (parsed.preview === true && parsed.editor !== true) return "editor";
  return "preview";
}

export function restorePaneState(): void {
  if (typeof localStorage === "undefined") return;

  // 저장된 상태가 없으면 = **신규 설치**. store 초기값 "preview"가 그대로 남는다
  // — Lapis는 읽기·탐색이 주 용도다.
  const paneRaw = localStorage.getItem(PANE_KEY);
  if (paneRaw) {
    try {
      const parsed = JSON.parse(paneRaw);
      if (parsed && typeof parsed === "object") {
        // context는 본문 페인과 **독립**이라 따로 복원한다.
        // 구 스키마(2026-08-05 이전 = context 필드 없음)면 undefined → false(펼침)로
        // 떨어져 신규 패널이 처음에 열린 채 보인다 — 의도된 기본값.
        contextCollapsed.set(!!parsed.context);
        mainPane.set(readMainPane(parsed));
        // 구 스키마를 읽었으면 새 스키마로 즉시 덮어써 마이그레이션을 1회로 끝낸다.
        if (typeof parsed.pane !== "string") persistPane();
      }
    } catch (e) {
      logWarn("stores/layout", "restorePaneState (pane) failed", e);
      localStorage.removeItem(PANE_KEY);
    }
  }

  const widthRaw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  if (widthRaw) {
    const n = Number(widthRaw);
    if (Number.isFinite(n)) {
      sidebarWidth.set(clampWidth(n));
    } else {
      localStorage.removeItem(SIDEBAR_WIDTH_KEY);
    }
  }

  const collapsedRaw = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
  if (collapsedRaw) {
    sidebarCollapsed.set(collapsedRaw === "true");
  }

  const ctxWidthRaw = localStorage.getItem(CONTEXT_WIDTH_KEY);
  if (ctxWidthRaw) {
    const n = Number(ctxWidthRaw);
    if (Number.isFinite(n)) {
      contextWidth.set(clampContextWidth(n));
    } else {
      localStorage.removeItem(CONTEXT_WIDTH_KEY);
    }
  }
}
