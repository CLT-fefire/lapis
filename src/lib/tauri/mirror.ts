import { invoke } from "@tauri-apps/api/core";

/**
 * Lapis 자체 SQLite mirror DB(`lapis-mem.db`)에 대한 TypeScript 래퍼.
 *
 * Rust 측 구현은 `src-tauri/src/mirror.rs`. PR1에선 sync + 쿼리만 노출하고,
 * MemorySearchModal / RelatedMemoriesPanel의 UI 전환은 PR2에서 진행한다.
 */

/** `mirror_sync_now` 1회 결과. */
export interface SyncReport {
  full: boolean;
  summaries_upserted: number;
  observations_upserted: number;
  deleted: number;
  /** wall clock 측정 (ms) — 30s 초과 시 PR2에서 progress UI 활성 기준 */
  duration_ms: number;
}

/** `mirror_sync_status` — 사이드바 status indicator(PR2)에서 사용. */
export interface SyncStatus {
  last_full_sync_at: number;
  last_incremental_sync_at: number;
  /** 마지막 실패 메시지 — sync 성공 시 null */
  last_failure: string | null;
  memory_count: number;
}

/**
 * mirror DB FTS5 검색 결과 — `memory.SearchHit`와 키 호환.
 *
 * PR2에서 MemorySearchModal이 `memoryFtsSearch` → `mirrorQueryMemories`로 전환되면
 * 이쪽 타입을 받게 된다. PR1 단계에선 호출자 없음.
 */
export interface MirrorSearchHit {
  id: number;
  /** "summary" | "observation" */
  type: "summary" | "observation";
  source_id: number;
  project: string;
  session_id: string;
  created_at: string;
  created_at_epoch: number;
  title_hint: string;
  /** FTS5 snippet — `<mark>...</mark>` 포함 */
  snippet_html: string;
  /** bm25 score (lower = better) */
  score: number;
  channel: "fts" | "semantic";
  /** observation의 type 컬럼 (kind='summary'이면 null) */
  obs_type: string | null;
}

/** files_mentioned 정확 매치 결과 — `memory.RelatedMemory` 대체. */
export interface MirrorRelatedHit {
  id: number;
  /** "summary" | "observation" */
  type: "summary" | "observation";
  source_id: number;
  project: string;
  title: string;
  /** "read" | "edited" | "modified" */
  matched_role: string;
  /** 매치된 file_path 원본 (절대 경로 또는 basename) */
  matched_file: string;
  obs_type: string | null;
  created_at: string;
  created_at_epoch: number;
}

/**
 * mirror DB와 claude-mem.db 사이 1회 sync.
 *
 * - `full=true`: `last_incremental_sync_at`을 0으로 잡고 전체 훑음 (ON CONFLICT DO UPDATE라 멱등).
 * - `full=false`: 증분 — 마지막 sync 이후 row만.
 *
 * 삭제는 항상 셋 diff로 처리. Rust 측 spawn_blocking 격리이라 main thread를 막지 않는다.
 */
export function mirrorSyncNow(full: boolean): Promise<SyncReport> {
  return invoke<SyncReport>("mirror_sync_now", { full });
}

/** sync 상태 조회. 사이드바 status indicator + 디버깅. */
export function mirrorSyncStatus(): Promise<SyncStatus> {
  return invoke<SyncStatus>("mirror_sync_status");
}

/**
 * mirror DB FTS5 풀텍스트 검색.
 * - `query`는 Rust 측에서 안전 sanitize.
 * - `filter`: `["*"]` / `[]` → 전체, 그 외 정확 매칭 + worktree 슬래시 prefix.
 */
export function mirrorQueryMemories(
  query: string,
  filter: string[],
  limit = 20,
): Promise<MirrorSearchHit[]> {
  return invoke<MirrorSearchHit[]>("mirror_query_memories", { query, filter, limit });
}

/**
 * 현재 vault 노트와 정확 매치되는 메모리 목록.
 * `files_mentioned`에서 `file_path = abs_path OR file_path = basename` 매치.
 */
export function mirrorQueryRelatedToNote(noteAbsPath: string): Promise<MirrorRelatedHit[]> {
  return invoke<MirrorRelatedHit[]>("mirror_query_related_to_note", { noteAbsPath });
}
