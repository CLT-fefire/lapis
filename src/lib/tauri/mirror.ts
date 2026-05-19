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
  /** 같은 메모리가 다룬 role 합집합 — 예: `["read"]`, `["modified"]`, `["read","modified"]` */
  matched_roles: ("read" | "edited" | "modified")[];
  /** 매치된 file_path 대표 1개 */
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
 * - `vaultPath`(선택): 삭제된 메모리의 .md를 vault에서 자동 정리.
 *   - frontmatter `content_hash`가 mirror와 일치 → 안전 삭제
 *   - mismatch/legacy(hash 없음) → `.lapis/orphans.json`에 mark + .md 보존
 *
 * 삭제는 항상 셋 diff로 처리. Rust 측 spawn_blocking 격리이라 main thread를 막지 않는다.
 */
export function mirrorSyncNow(full: boolean, vaultPath?: string | null): Promise<SyncReport> {
  return invoke<SyncReport>("mirror_sync_now", { full, vaultPath: vaultPath ?? null });
}

/** sync 상태 조회. 사이드바 status indicator + 디버깅. */
export function mirrorSyncStatus(): Promise<SyncStatus> {
  return invoke<SyncStatus>("mirror_sync_status");
}

/**
 * 검색 엔진 쿼리 — Phase Search에서 tantivy + lindera 한국어 형태소로 전환.
 *
 * - `query`는 Rust 측에서 안전 sanitize + prefix `token*` 변환
 * - `filter`: `["*"]` / `[]` → 전체, 그 외 정확 매칭 (tantivy STRING 필드)
 * - `includeSummaries`/`includeObservations`: kind 필터. 둘 다 false면 빈 결과
 *
 * 호환성: 함수명 + 시그니처 + 반환 타입 모두 기존 mirror FTS5와 동일 → UI 무변경.
 * 내부적으로 `search_query` Tauri 명령 호출 (tantivy 인덱스). channel="tantivy".
 */
export function mirrorQueryMemories(
  query: string,
  filter: string[],
  limit = 20,
  includeSummaries = true,
  includeObservations = true,
): Promise<MirrorSearchHit[]> {
  return invoke<MirrorSearchHit[]>("search_query", {
    query,
    filter,
    limit,
    includeSummaries,
    includeObservations,
  });
}

/**
 * 현재 vault 노트와 정확 매치되는 메모리 목록.
 * `files_mentioned`에서 `file_path = abs_path OR file_path = basename` 매치.
 */
export function mirrorQueryRelatedToNote(noteAbsPath: string): Promise<MirrorRelatedHit[]> {
  return invoke<MirrorRelatedHit[]>("mirror_query_related_to_note", { noteAbsPath });
}

