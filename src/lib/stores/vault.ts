import { writable, get } from "svelte/store";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  listNotes,
  readNote,
  scanLinks,
  readAllNotes,
  type NoteEntry,
} from "$lib/tauri/notes";
import { buildIndex, resolveTarget, type LinkIndex } from "$lib/linkIndex";
import { rebuildIndexes, clearIndexes } from "$lib/stores/search";
import { buildTagIndex, tagIndex, clearTagIndex } from "$lib/stores/tags";

const STORAGE_KEY = "lapis.last-vault-path";

export const vaultPath = writable<string | null>(null);
export const notes = writable<NoteEntry[]>([]);
export const currentNotePath = writable<string | null>(null);
export const currentNoteContent = writable<string>("");
export const linkIndex = writable<LinkIndex | null>(null);

export async function pickAndOpenVault(): Promise<void> {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: "Lapis — Vault 선택",
  });
  if (typeof selected === "string") {
    await openVault(selected);
  }
}

export async function openVault(path: string): Promise<void> {
  vaultPath.set(path);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, path);
  }
  currentNotePath.set(null);
  currentNoteContent.set("");
  await reloadNotes();
}

export async function reloadNotes(): Promise<void> {
  const root = get(vaultPath);
  if (!root) return;
  try {
    const list = await listNotes(root);
    notes.set(list);
  } catch (e) {
    console.error("list_notes failed", e);
    notes.set([]);
  }

  // 링크 인덱스 + 검색 인덱스 백그라운드 갱신 — 트리 표시는 막지 않음
  try {
    const [links, contents] = await Promise.all([scanLinks(root), readAllNotes(root)]);
    linkIndex.set(buildIndex(links));
    tagIndex.set(buildTagIndex(links));
    rebuildIndexes(links, contents);
  } catch (e) {
    console.error("link/search index build failed", e);
    linkIndex.set(null);
    clearTagIndex();
    clearIndexes();
  }
}

/**
 * Wikilink target name (alias / title / file stem) → 매칭되는 노트로 점프.
 * 매칭 없으면 false 반환.
 */
export async function jumpToWikilink(target: string): Promise<boolean> {
  const idx = get(linkIndex);
  if (!idx) return false;
  const path = resolveTarget(target, idx);
  if (!path) return false;
  await selectNote(path);
  return true;
}

export async function selectNote(path: string): Promise<void> {
  // editor 모듈을 lazy import — circular import 회피
  // (editor가 vault store를 import하므로 직접 top-level import 시 초기화 순서 위험)
  let editor: typeof import("./editor") | null = null;
  try {
    editor = await import("./editor");
  } catch (e) {
    console.warn("editor module load failed", e);
  }

  // 이전 노트가 dirty면 먼저 저장
  if (editor && editor.getIsDirty()) {
    try {
      await editor.saveCurrentNote();
    } catch (e) {
      console.warn("save before navigate failed", e);
    }
  }

  try {
    const content = await readNote(path);
    currentNotePath.set(path);
    currentNoteContent.set(content);
    // editor 상태 동기화 — 새 노트 기준으로 dirty 해제
    if (editor) editor.markSaved(content);
  } catch (e) {
    console.error("read_note failed", e);
    currentNoteContent.set("");
  }
}

export async function restoreLastVault(): Promise<void> {
  if (typeof localStorage === "undefined") return;
  const last = localStorage.getItem(STORAGE_KEY);
  if (!last) return;
  try {
    await openVault(last);
  } catch (e) {
    console.warn("restoreLastVault failed", e);
    localStorage.removeItem(STORAGE_KEY);
  }
}
