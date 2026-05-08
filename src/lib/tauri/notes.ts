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

export function writeNote(vaultPath: string, path: string, content: string): Promise<void> {
  return invoke<void>("write_note", { vaultPath, path, content });
}

export interface LinkInfo {
  source_path: string;
  source_name: string;
  title: string | null;
  aliases: string[];
  targets: string[]; // raw [[...]] inner text — `target` 또는 `target|alias` 그대로
  tags: string[];    // frontmatter `tags` + 본문 `#tag` 통합 (대소문자 보존, 중복 제거됨)
}

export function scanLinks(vaultPath: string): Promise<LinkInfo[]> {
  return invoke<LinkInfo[]>("scan_links", { vaultPath });
}

export interface NoteContent {
  path: string;
  name: string;
  body: string;
}

export function readAllNotes(vaultPath: string): Promise<NoteContent[]> {
  return invoke<NoteContent[]>("read_all_notes", { vaultPath });
}
