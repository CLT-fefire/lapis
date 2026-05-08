import { writable, get } from "svelte/store";

const STORAGE_KEY = "lapis.pane-state";

export const editorCollapsed = writable<boolean>(false);
export const previewCollapsed = writable<boolean>(false);

// 둘 다 접히는 상태는 의미 없으므로 가드. 다른 쪽이 이미 접혀 있으면 토글 거부.
export function toggleEditor(): void {
  if (get(previewCollapsed)) return;
  editorCollapsed.update((v) => !v);
  persist();
}

export function togglePreview(): void {
  if (get(editorCollapsed)) return;
  previewCollapsed.update((v) => !v);
  persist();
}

function persist(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      editor: get(editorCollapsed),
      preview: get(previewCollapsed),
    }),
  );
}

export function restorePaneState(): void {
  if (typeof localStorage === "undefined") return;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    // 손상된 상태(둘 다 접힘) 복원 거부 — 가드 일관성
    if (parsed.editor && parsed.preview) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    editorCollapsed.set(!!parsed.editor);
    previewCollapsed.set(!!parsed.preview);
  } catch (e) {
    console.warn("restorePaneState failed", e);
    localStorage.removeItem(STORAGE_KEY);
  }
}
