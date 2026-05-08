import { writable, get } from "svelte/store";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listNotes, readNote, type NoteEntry } from "$lib/tauri/notes";

const STORAGE_KEY = "lapis.last-vault-path";

export const vaultPath = writable<string | null>(null);
export const notes = writable<NoteEntry[]>([]);
export const currentNotePath = writable<string | null>(null);
export const currentNoteContent = writable<string>("");

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
