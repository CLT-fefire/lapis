import { invoke } from "@tauri-apps/api/core";

export interface NoteEntry {
  path: string;
  rel_path: string;
  name: string;
  is_dir: boolean;
  children: NoteEntry[] | null;
}

export function listNotes(vaultPath: string): Promise<NoteEntry[]> {
  return invoke<NoteEntry[]>("list_notes", { vaultPath });
}

export function readNote(path: string): Promise<string> {
  return invoke<string>("read_note", { path });
}

export interface LinkInfo {
  source_path: string;
  source_name: string;
  title: string | null;
  aliases: string[];
  targets: string[]; // raw [[...]] inner text — `target` 또는 `target|alias` 그대로
}

export function scanLinks(vaultPath: string): Promise<LinkInfo[]> {
  return invoke<LinkInfo[]>("scan_links", { vaultPath });
}
