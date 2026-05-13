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

/**
 * claude-mem `observations` 테이블 한 row (PR3).
 * 일반적으로 frontend는 직접 다루지 않고 Rust 측에서 export 흐름에만 사용.
 */
export interface Observation {
  id: number;
  memory_session_id: string;
  project: string;
  /** observations.type 컬럼 — 학습/관찰/결정 등 분류 라벨 */
  type: string;
  title: string | null;
  subtitle: string | null;
  text: string | null;
  narrative: string | null;
  facts: string | null;
  concepts: string | null;
  files_read: string | null;
  files_modified: string | null;
  created_at: string;
  created_at_epoch: number;
}

export interface PreviewBreakdown {
  total_candidates: number;
  already_exported: number;
  new_count: number;
}

/** summary / observation 각각의 preview 카운트 (include_*=false면 모두 0) */
export interface PreviewReport {
  summaries: PreviewBreakdown;
  observations: PreviewBreakdown;
}

export interface ExportBreakdown {
  created: number;
  skipped: number;
  errors: string[];
  total_candidates: number;
}

/** summary / observation 각각의 export 결과 */
export interface ExportReport {
  summaries: ExportBreakdown;
  observations: ExportBreakdown;
}

export interface SearchHit {
  id: number;
  /** "summary" | "observation" — UI 배지 + memoryFindExportedNote 호출 시 kind 인자 */
  type: "summary" | "observation";
  project: string;
  created_at: string;
  created_at_epoch: number;
  /** request/title 첫 줄 또는 fallback (최대 120자) */
  title_hint: string;
  /** FTS5 snippet — `<mark>...</mark>` 포함, UI에서 sanitized 본인 데이터라 그대로 렌더 가능 */
  snippet_html: string;
  /** bm25 score (lower = better relevance) */
  score: number;
  /** "fts" 또는 (향후) "semantic" — 결과 병합 시 dedup 키와 함께 사용 */
  channel: "fts" | "semantic";
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
 * vault의 `_memories/**` / `_memories/observations/**` 스캔으로 sync 시 신규/skip 카운트 미리 계산.
 * `includeSummaries=false` 또는 `includeObservations=false`인 쪽은 모두 0 반환.
 */
export function memoryPreviewExport(
  vaultPath: string,
  filter: string[],
  includeSummaries: boolean,
  includeObservations: boolean,
): Promise<PreviewReport> {
  return invoke<PreviewReport>("memory_preview_export", {
    vaultPath,
    filter,
    includeSummaries,
    includeObservations,
  });
}

/**
 * filter에 매칭되는 session_summaries / observations를 vault에 export.
 * - summaries: `_memories/{YYYY-MM}/*.md`
 * - observations: `_memories/observations/{YYYY-MM}/*.md`
 * 같은 (kind, mem_id) 페어가 이미 있으면 skip (덮어쓰기 X).
 */
export function memoryExportToVault(
  vaultPath: string,
  filter: string[],
  includeSummaries: boolean,
  includeObservations: boolean,
): Promise<ExportReport> {
  return invoke<ExportReport>("memory_export_to_vault", {
    vaultPath,
    filter,
    includeSummaries,
    includeObservations,
  });
}

/**
 * SQLite FTS5 통합 풀텍스트 검색 (session_summaries_fts + observations_fts).
 * - 입력은 안전 sanitize 후 phrase token AND 매칭.
 * - 한국어는 어절 단위만 매치(FTS5 기본 토크나이저 한계).
 * - 두 결과 bm25 score 오름차순 병합 정렬 후 limit개 take.
 * - `includeSummaries=false` 또는 `includeObservations=false`로 type 필터 가능.
 */
export function memoryFtsSearch(
  query: string,
  filter: string[],
  limit = 20,
  includeSummaries = true,
  includeObservations = true,
): Promise<SearchHit[]> {
  return invoke<SearchHit[]>("memory_fts_search", {
    query,
    filter,
    limit,
    includeSummaries,
    includeObservations,
  });
}

/**
 * (mem_id, kind) 페어로 vault 안 export된 노트 절대 경로 찾기 (없으면 null).
 * - `kind="summary"` → `_memories/{YYYY-MM}/**` walk (observations/ 제외)
 * - `kind="observation"` → `_memories/observations/{YYYY-MM}/**` walk
 * session_summaries.id와 observations.id는 별 PK space라 kind 분기 필수.
 */
export function memoryFindExportedNote(
  vaultPath: string,
  memId: number,
  kind: "summary" | "observation",
): Promise<string | null> {
  return invoke<string | null>("memory_find_exported_note", { vaultPath, memId, kind });
}

export interface RelatedMemory {
  mem_id: number;
  /** "summary" | "observation" — UI 배지 분기 */
  type: "summary" | "observation";
  abs_path: string;
  title_hint: string;
  project: string;
  date: string;
  /** "files_read" | "files_edited" | "files_modified" | "both" | "body" */
  matched_in: string;
}

/**
 * 현재 노트의 basename과 매칭되는 메모리 노트 목록.
 * vault `_memories/**` 안의 메모리 노트 frontmatter `files_read`/`files_edited` 검사.
 * 단순 substring 매칭 (false positive 가능, MVP).
 */
export function memoryRelatedToNote(
  vaultPath: string,
  noteAbsPath: string,
): Promise<RelatedMemory[]> {
  return invoke<RelatedMemory[]>("memory_related_to_note", { vaultPath, noteAbsPath });
}
