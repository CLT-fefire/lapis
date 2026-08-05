import { writable, get } from "svelte/store";

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

export const editorCollapsed = writable<boolean>(false);
export const previewCollapsed = writable<boolean>(false);
export const sidebarCollapsed = writable<boolean>(false);
export const sidebarWidth = writable<number>(DEFAULT_SIDEBAR_WIDTH);
/** 우측 컨텍스트 패널(관계·백링크·목차·속성). Editor/Preview와 달리 **독립** 접힘 — 가드 없음. */
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

// 둘 다 접히는 상태는 의미 없으므로 가드. 다른 쪽이 이미 접혀 있으면 토글 거부.
export function toggleEditor(): void {
  if (get(previewCollapsed)) return;
  editorCollapsed.update((v) => !v);
  persistPane();
}

export function togglePreview(): void {
  if (get(editorCollapsed)) return;
  previewCollapsed.update((v) => !v);
  persistPane();
}

/** 컨텍스트 패널은 Editor/Preview 가드와 무관하게 언제든 접고 펼 수 있다. */
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
  editorCollapsed.set(true);
  previewCollapsed.set(false);
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
      editor: get(editorCollapsed),
      preview: get(previewCollapsed),
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

export function restorePaneState(): void {
  if (typeof localStorage === "undefined") return;

  const paneRaw = localStorage.getItem(PANE_KEY);
  if (paneRaw) {
    try {
      const parsed = JSON.parse(paneRaw);
      if (parsed && typeof parsed === "object") {
        // context는 Editor/Preview 가드와 **독립**이라 먼저 복원한다.
        // 구 스키마(2026-08-05 이전 = context 필드 없음)면 undefined → false(펼침)로
        // 떨어져 신규 패널이 처음에 열린 채 보인다 — 의도된 기본값.
        contextCollapsed.set(!!parsed.context);
        if (parsed.editor && parsed.preview) {
          // 손상된 상태(둘 다 접힘) 복원 거부 — 가드 일관성
          localStorage.removeItem(PANE_KEY);
        } else {
          editorCollapsed.set(!!parsed.editor);
          previewCollapsed.set(!!parsed.preview);
        }
      }
    } catch (e) {
      console.warn("restorePaneState (pane) failed", e);
      localStorage.removeItem(PANE_KEY);
    }
  } else {
    // 저장된 상태가 없다 = **신규 설치**. Lapis는 읽기·탐색이 주 용도라 Editor는
    // 접은 채 시작해 Preview에 공간을 준다. 기존 사용자의 저장값은 위 분기가
    // 그대로 존중하므로 이 기본값이 남의 레이아웃을 덮어쓰지 않는다.
    // (원할 때 새 기본값으로 맞추려면 ⌘K → "레이아웃 초기화".)
    editorCollapsed.set(true);
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
