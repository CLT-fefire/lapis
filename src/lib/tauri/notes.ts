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

/** parent_dir(vault 상대 또는 절대) 안에 새 .md 노트 생성. 생성된 절대 경로 반환. */
export function createNote(
  vaultPath: string,
  parentDir: string,
  fileName: string,
  content: string,
): Promise<string> {
  return invoke<string>("create_note", { vaultPath, parentDir, fileName, content });
}

/** parent_dir 안에 새 폴더 생성. 절대 경로 반환. */
export function createFolder(
  vaultPath: string,
  parentDir: string,
  folderName: string,
): Promise<string> {
  return invoke<string>("create_folder", { vaultPath, parentDir, folderName });
}

/** 시스템 휴지통으로 이동. 파일·폴더 모두 가능. */
export function deleteNote(vaultPath: string, path: string): Promise<void> {
  return invoke<void>("delete_note", { vaultPath, path });
}

/** 같은 디렉토리 안에서 이름 변경. 새 절대 경로 반환. */
export function renameNote(
  vaultPath: string,
  oldPath: string,
  newName: string,
): Promise<string> {
  return invoke<string>("rename_note", { vaultPath, oldPath, newName });
}

/** 다른 폴더로 이동. 새 절대 경로 반환. */
export function moveNote(
  vaultPath: string,
  path: string,
  newParentDir: string,
): Promise<string> {
  return invoke<string>("move_note", { vaultPath, path, newParentDir });
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

/** 노트와 같은 폴더에서 같은 stem으로 시작하는 이미지(svg/png/jpg/jpeg/gif/webp) — Phase 4.4.b */
export interface AssetInfo {
  name: string;
  abs_path: string;
  kind: string;
}

export function findAssetsForNote(
  vaultPath: string,
  notePath: string,
): Promise<AssetInfo[]> {
  return invoke<AssetInfo[]>("find_assets_for_note", { vaultPath, notePath });
}

/**
 * 링크 자동 갱신 전 affected 노트의 원본을 vault 안의 hidden 디렉토리로 백업.
 * 백업 디렉토리 절대 경로 반환.
 *
 * `backupDirRel`은 vault 상대 경로 — 관례상 `.lapis/link-rewrite-backup/<ISO-ts>`.
 * `.`로 시작하므로 `list_notes`/트리에서 자동 제외.
 */
export function backupNotes(
  vaultPath: string,
  sourcePaths: string[],
  backupDirRel: string,
): Promise<string> {
  return invoke<string>("backup_notes", { vaultPath, sourcePaths, backupDirRel });
}
