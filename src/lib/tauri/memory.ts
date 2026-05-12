import { invoke } from "@tauri-apps/api/core";

export interface SessionSummary {
  id: number;
  memory_session_id: string;
  project: string;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
  files_read: string | null;
  files_edited: string | null;
  notes: string | null;
  created_at: string;
  created_at_epoch: number;
}

export interface PreviewReport {
  total_candidates: number;
  already_exported: number;
  new_count: number;
}

export interface ExportReport {
  created: number;
  skipped: number;
  errors: string[];
  total_candidates: number;
}

/**
 * claude-mem.db `session_summaries` 테이블에서 filter에 매칭되는 row 목록 반환.
 * filter:
 *   - `["*"]` 또는 빈 배열 → 전체
 *   - `["Lapis", "Lysn_Epic"]` → 정확 매칭 + worktree 슬래시 prefix(`Lapis/...`) 자동 포함
 */
export function memoryListSummaries(filter: string[]): Promise<SessionSummary[]> {
  return invoke<SessionSummary[]>("memory_list_summaries", { filter });
}

/**
 * vault의 `_memories/**` frontmatter `mem_id`를 스캔해 sync 시 신규/skip 예상치 미리 계산.
 */
export function memoryPreviewExport(
  vaultPath: string,
  filter: string[],
): Promise<PreviewReport> {
  return invoke<PreviewReport>("memory_preview_export", { vaultPath, filter });
}

/**
 * filter에 매칭되는 session_summaries를 vault의 `_memories/{YYYY-MM}/*.md`로 export.
 * 같은 mem_id가 이미 vault에 있으면 skip (덮어쓰기 X).
 */
export function memoryExportToVault(
  vaultPath: string,
  filter: string[],
): Promise<ExportReport> {
  return invoke<ExportReport>("memory_export_to_vault", { vaultPath, filter });
}
