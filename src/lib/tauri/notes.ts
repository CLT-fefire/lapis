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
  targets: string[]; // wikilink `[[...]]` + md link `[text](file.md)` 통합. last segment + .md 제거된 형태
  tags: string[];    // frontmatter `tags` 만 (Phase 3.0부터 본문 #tag 폐기). kebab-case + nested(`/`) 허용
  // SharedDocs 4키 스키마 (Markdown-Tag-Management-Guide.md §2)
  doc_kind: string | null; // requirements | spec | plan | solution | analysis | brainstorm | howto | reference | meeting-notes
  topic: string | null;    // kebab-case 단일 도메인
  related: string[];       // 파일 stem 배열 (cross-ref)
}

export function scanLinks(vaultPath: string): Promise<LinkInfo[]> {
  return invoke<LinkInfo[]>("scan_links", { vaultPath });
}

/** 단일 노트의 LinkInfo만 추출 — file watcher 증분 갱신용 */
export function scanLinkSingle(vaultPath: string, path: string): Promise<LinkInfo> {
  return invoke<LinkInfo>("scan_link_single", { vaultPath, path });
}

export interface NoteContent {
  path: string;
  name: string;
  body: string;
}

export function readAllNotes(vaultPath: string): Promise<NoteContent[]> {
  return invoke<NoteContent[]>("read_all_notes", { vaultPath });
}
