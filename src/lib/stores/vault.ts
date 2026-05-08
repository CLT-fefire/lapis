import { writable, get } from "svelte/store";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listNotes, readNote, scanLinks, type NoteEntry } from "$lib/tauri/notes";
import { buildIndex, resolveTarget, type LinkIndex } from "$lib/linkIndex";

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

  // 링크 인덱스는 트리와 독립적으로 백그라운드 갱신 — 트리 표시는 막지 않음
  try {
    const links = await scanLinks(root);
    linkIndex.set(buildIndex(links));
  } catch (e) {
    console.error("scan_links failed", e);
    linkIndex.set(null);
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
  try {
    const content = await readNote(path);
    currentNotePath.set(path);
    currentNoteContent.set(content);
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
