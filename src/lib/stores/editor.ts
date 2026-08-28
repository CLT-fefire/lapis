import { writable, get } from "svelte/store";
import { writeNote } from "$lib/tauri/notes";
import { vaultPath, currentNotePath, currentNoteContent, reloadNotes } from "./vault";
import { logError } from "$lib/stores/usage";

const AUTOSAVE_DEBOUNCE_MS = 2000;

export const editorContent = writable<string>("");
export const lastSavedContent = writable<string>("");
export const isDirty = writable<boolean>(false);
export const isSaving = writable<boolean>(false);
export const lastSaveError = writable<string | null>(null);

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

export function getIsDirty(): boolean {
  return get(isDirty);
}

/**
 * 노트 내용이 외부에서 set된 경우(예: 사이드바에서 다른 노트 클릭) 호출.
 * editor 상태를 새 내용 기준으로 리셋 — dirty 해제.
 */
export function markSaved(content: string): void {
  cancelAutoSave();
  lastSavedContent.set(content);
  editorContent.set(content);
  isDirty.set(false);
  lastSaveError.set(null);
}

/**
 * Editor에서 사용자가 입력할 때마다 호출. dirty 갱신 + 자동 저장 타이머 reset.
 */
export function noteContentChanged(newContent: string): void {
  editorContent.set(newContent);
  const saved = get(lastSavedContent);
  isDirty.set(newContent !== saved);

  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  if (newContent !== saved) {
    autoSaveTimer = setTimeout(() => {
      void saveCurrentNote();
    }, AUTOSAVE_DEBOUNCE_MS);
  }
}

function cancelAutoSave(): void {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
}

/**
 * 즉시 저장. 이미 저장 중이거나 dirty가 아니면 no-op.
 * 저장 후 link/tag 인덱스 재빌드 트리거 (변경된 wikilink/tag 반영).
 */
export async function saveCurrentNote(): Promise<void> {
  if (get(isSaving)) return;
  if (!get(isDirty)) return;

  const path = get(currentNotePath);
  const vault = get(vaultPath);
  const content = get(editorContent);
  if (!path || !vault) return;

  cancelAutoSave();
  isSaving.set(true);
  lastSaveError.set(null);
  try {
    await writeNote(vault, path, content);
    lastSavedContent.set(content);
    currentNoteContent.set(content);
    isDirty.set(false);
    // 인덱스 재빌드 — 새 wikilink/태그가 반영되도록
    void reloadNotes();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError("stores/editor", "write_note failed:", msg);
    lastSaveError.set(msg);
  } finally {
    isSaving.set(false);
  }
}
