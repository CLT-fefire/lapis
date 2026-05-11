import { writable, get } from "svelte/store";

const PANE_KEY = "lapis.pane-state";
const SIDEBAR_WIDTH_KEY = "lapis.sidebar-width";

export const DEFAULT_SIDEBAR_WIDTH = 260;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 600;

export const editorCollapsed = writable<boolean>(false);
export const previewCollapsed = writable<boolean>(false);
export const sidebarWidth = writable<number>(DEFAULT_SIDEBAR_WIDTH);

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

function clampWidth(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(px)));
}

export function setSidebarWidth(px: number): void {
  const clamped = clampWidth(px);
  sidebarWidth.set(clamped);
  persistSidebarWidth(clamped);
}

export function resetSidebarWidth(): void {
  setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
}

function persistPane(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    PANE_KEY,
    JSON.stringify({
      editor: get(editorCollapsed),
      preview: get(previewCollapsed),
    }),
  );
}

function persistSidebarWidth(px: number): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SIDEBAR_WIDTH_KEY, String(px));
}

export function restorePaneState(): void {
  if (typeof localStorage === "undefined") return;

  const paneRaw = localStorage.getItem(PANE_KEY);
  if (paneRaw) {
    try {
      const parsed = JSON.parse(paneRaw);
      if (parsed && typeof parsed === "object") {
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
}
