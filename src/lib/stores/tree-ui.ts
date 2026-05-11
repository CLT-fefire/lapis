import { writable } from "svelte/store";
import type { NoteEntry } from "$lib/tauri/notes";

/** 사이드바 트리 우클릭 컨텍스트 메뉴 상태. */
export interface ContextTarget {
  x: number;
  y: number;
  entry: NoteEntry;
}

export const contextTarget = writable<ContextTarget | null>(null);

/** 새 노트 모달 요청 — parent dir 사전 채움. */
export interface NewNoteRequest {
  parentDir: string;
  parentLabel: string;
}
export const newNoteRequest = writable<NewNoteRequest | null>(null);

/** 인라인 rename 요청 — path가 매칭되는 FileTree row가 편집 진입 */
export const renameRequest = writable<string | null>(null);

export function closeContextMenu(): void {
  contextTarget.set(null);
}

export function openNewNote(parentDir: string, parentLabel: string): void {
  newNoteRequest.set({ parentDir, parentLabel });
}

export function closeNewNote(): void {
  newNoteRequest.set(null);
}

export function requestRename(path: string): void {
  renameRequest.set(path);
}

export function clearRenameRequest(): void {
  renameRequest.set(null);
}
