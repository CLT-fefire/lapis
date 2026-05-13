use crate::mirror;
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

/// 모달 progress 이벤트 이름.
const EXPORT_PROGRESS_EVENT: &str = "memory-export-progress";

/// 매 N row마다 emit. 너무 잦으면 IPC + Svelte re-render 비용, 너무 드물면 progress 안 부드러움.
/// 50은 10277개 기준 ~200번 발화 — 부드럽고 부담 없음.
const EMIT_EVERY: usize = 50;

/// export 중 모달에 발행하는 progress payload.
#[derive(Debug, Serialize, Clone)]
pub struct ExportProgress {
    /// "summary" | "observation" — 어느 phase 진행 중인지
    pub phase: String,
    pub current: usize,
    pub total: usize,
    pub created: usize,
    pub skipped: usize,
    /// 에러 카운트만 (메시지는 done 단계 ExportReport.errors에서)
    pub errors: usize,
}

/// 한 phase 안에서 처리 중 일정 주기마다 progress emit. 실패는 무시 (UI 보조용).
fn emit_progress(
    app: &AppHandle,
    phase: &str,
    current: usize,
    total: usize,
    created: usize,
    skipped: usize,
    errors: usize,
) {
    let _ = app.emit(
        EXPORT_PROGRESS_EVENT,
        ExportProgress {
            phase: phase.to_string(),
            current,
            total,
            created,
            skipped,
            errors,
        },
    );
}

/// claude-mem DB 위치 — 고정 경로.
fn db_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|e| format!("HOME 미설정: {e}"))?;
    Ok(PathBuf::from(home).join(".claude-mem").join("claude-mem.db"))
}

fn open_ro() -> Result<Connection, String> {
    let p = db_path()?;
    if !p.exists() {
        return Err(format!("claude-mem DB가 없습니다: {}", p.display()));
    }
    Connection::open_with_flags(
        &p,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("DB open 실패: {e}"))
}

#[derive(Debug, Serialize, Clone)]
pub struct SessionSummary {
    pub id: i64,
    pub memory_session_id: String,
    pub project: String,
    pub request: Option<String>,
    pub investigated: Option<String>,
    pub learned: Option<String>,
    pub completed: Option<String>,
    pub next_steps: Option<String>,
    pub files_read: Option<String>,
    pub files_edited: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub created_at_epoch: i64,
}

/// project 필터 SQL 조건 빌더.
/// - 빈 배열 또는 ["*"] → 전체
/// - ["Lapis", "Lysn_Epic"] → `(project = 'Lapis' OR project LIKE 'Lapis/%' OR project = 'Lysn_Epic' OR project LIKE 'Lysn_Epic/%')`
///   (정확 매칭 + worktree 슬래시 prefix)
fn build_project_where(filter: &[String]) -> (String, Vec<String>) {
    if filter.is_empty() || filter.iter().any(|f| f == "*") {
        return (String::new(), Vec::new());
    }
    let mut clauses = Vec::new();
    let mut params = Vec::new();
    for p in filter {
        clauses.push("project = ?".to_string());
        params.push(p.clone());
        clauses.push("project LIKE ?".to_string());
        params.push(format!("{}/%", p));
    }
    let where_sql = format!(" WHERE ({})", clauses.join(" OR "));
    (where_sql, params)
}

pub fn list_summaries_inner(filter: &[String]) -> Result<Vec<SessionSummary>, String> {
    let conn = open_ro()?;
    let (where_sql, params) = build_project_where(filter);
    let sql = format!(
        "SELECT id, memory_session_id, project, request, investigated, learned, completed, \
         next_steps, files_read, files_edited, notes, created_at, created_at_epoch \
         FROM session_summaries{} ORDER BY created_at_epoch DESC",
        where_sql
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("prepare: {e}"))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |r| {
            Ok(SessionSummary {
                id: r.get(0)?,
                memory_session_id: r.get(1)?,
                project: r.get(2)?,
                request: r.get(3)?,
                investigated: r.get(4)?,
                learned: r.get(5)?,
                completed: r.get(6)?,
                next_steps: r.get(7)?,
                files_read: r.get(8)?,
                files_edited: r.get(9)?,
                notes: r.get(10)?,
                created_at: r.get(11)?,
                created_at_epoch: r.get(12)?,
            })
        })
        .map_err(|e| format!("query_map: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect: {e}"))?;
    Ok(rows)
}

#[tauri::command]
pub fn memory_list_summaries(filter: Vec<String>) -> Result<Vec<SessionSummary>, String> {
    list_summaries_inner(&filter)
}

/// claude-mem `observations` 테이블의 한 row.
/// session_summaries보다 작은 단위(prompt-level)의 학습/관찰/결정. PR3에서 vault export 대상.
/// 핵심 차이: `files_read`(6911건) / `files_modified`(3060건)이 실제로 채워져 있어
/// RelatedMemoriesPanel의 정확 매치 신호 source가 됨. (session_summaries.files_*는 전부 NULL)
#[derive(Debug, Serialize, Clone)]
pub struct Observation {
    pub id: i64,
    pub memory_session_id: String,
    pub project: String,
    /// observations.type 컬럼 — 학습/관찰/결정 등 분류 라벨. Rust 예약어 회피용 raw identifier.
    pub r#type: String,
    pub title: Option<String>,
    pub subtitle: Option<String>,
    pub text: Option<String>,
    pub narrative: Option<String>,
    pub facts: Option<String>,
    pub concepts: Option<String>,
    pub files_read: Option<String>,
    pub files_modified: Option<String>,
    /// claude-mem이 박제한 hash. 없을 수 있어 Option. Lapis export 시 fallback으로 자체 계산.
    pub content_hash: Option<String>,
    pub created_at: String,
    pub created_at_epoch: i64,
}

/// observations 테이블에서 project filter 적용 후 최신순으로 전체 row 조회.
/// SessionSummary 패턴과 동일 — `build_project_where` 재사용.
pub fn list_observations_inner(filter: &[String]) -> Result<Vec<Observation>, String> {
    let conn = open_ro()?;
    let (where_sql, params) = build_project_where(filter);
    let sql = format!(
        "SELECT id, memory_session_id, project, type, title, subtitle, text, narrative, \
         facts, concepts, files_read, files_modified, content_hash, created_at, created_at_epoch \
         FROM observations{} ORDER BY created_at_epoch DESC",
        where_sql
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("prepare: {e}"))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |r| {
            Ok(Observation {
                id: r.get(0)?,
                memory_session_id: r.get(1)?,
                project: r.get(2)?,
                r#type: r.get(3)?,
                title: r.get(4)?,
                subtitle: r.get(5)?,
                text: r.get(6)?,
                narrative: r.get(7)?,
                facts: r.get(8)?,
                concepts: r.get(9)?,
                files_read: r.get(10)?,
                files_modified: r.get(11)?,
                content_hash: r.get(12)?,
                created_at: r.get(13)?,
                created_at_epoch: r.get(14)?,
            })
        })
        .map_err(|e| format!("query_map: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect: {e}"))?;
    Ok(rows)
}

#[derive(Debug, Serialize)]
pub struct SearchHit {
    pub id: i64,
    /// "summary" | "observation" — UI 배지 + memory_find_exported_note 호출 시 kind 인자.
    /// session_summaries.id와 observations.id는 별 PK space라 (kind, id) 페어로 식별.
    #[serde(rename = "type")]
    pub kind: String,
    pub project: String,
    pub created_at: String,
    pub created_at_epoch: i64,
    pub title_hint: String, // request 첫 줄 또는 fallback
    pub snippet_html: String, // FTS5 snippet — <mark>...</mark> 포함, UI에서 그대로 렌더
    pub score: f64,         // bm25 (lower = better relevance)
    pub channel: String,    // "fts" — 향후 "semantic" 추가 시 dedup 키
}

/// 사용자 입력을 FTS5 안전 쿼리로 변환.
/// - 공백으로 토큰 분리
/// - 각 토큰에서 FTS5 특수문자 제거(alnum/한글/언더스코어/하이픈만 유지)
/// - 비어있지 않은 토큰을 double-quoted phrase로 → 묵시적 AND
fn sanitize_fts_query(q: &str) -> String {
    q.split_whitespace()
        .map(|w| {
            let cleaned: String = w
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
                .collect();
            if cleaned.is_empty() {
                String::new()
            } else {
                format!("\"{}\"", cleaned)
            }
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn first_nonempty_line(opts: &[&Option<String>]) -> String {
    for opt in opts {
        if let Some(s) = opt {
            for line in s.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    return trimmed.chars().take(120).collect();
                }
            }
        }
    }
    String::from("(no title)")
}

/// 통합 FTS5 풀텍스트 검색.
/// - `include_summaries`: session_summaries_fts 결과 포함
/// - `include_observations`: observations_fts 결과 포함
/// 두 결과는 bm25 score 오름차순으로 병합 정렬 후 `limit`개 take.
#[tauri::command]
pub fn memory_fts_search(
    query: String,
    filter: Vec<String>,
    limit: u32,
    include_summaries: bool,
    include_observations: bool,
) -> Result<Vec<SearchHit>, String> {
    let q = sanitize_fts_query(&query);
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let conn = open_ro()?;
    let cap = limit.clamp(1, 200) as usize;
    let mut all: Vec<SearchHit> = Vec::new();

    if include_summaries {
        let hits = fts_search_summaries(&conn, &q, &filter, limit)?;
        all.extend(hits);
    }
    if include_observations {
        let hits = fts_search_observations(&conn, &q, &filter, limit)?;
        all.extend(hits);
    }

    // bm25 score 오름차순 — partial_cmp NaN은 Ordering::Equal로 안전 처리
    all.sort_by(|a, b| {
        a.score
            .partial_cmp(&b.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    all.truncate(cap);
    Ok(all)
}

fn fts_search_summaries(
    conn: &Connection,
    q: &str,
    filter: &[String],
    limit: u32,
) -> Result<Vec<SearchHit>, String> {
    let (proj_where, proj_params) = build_project_where(filter);
    let proj_and = if proj_where.is_empty() {
        String::new()
    } else {
        format!(" AND {}", &proj_where[" WHERE ".len()..])
    };
    let sql = format!(
        "SELECT s.id, s.project, s.request, s.investigated, s.learned, s.completed, \
         s.next_steps, s.notes, s.created_at, s.created_at_epoch, \
         snippet(session_summaries_fts, -1, '<mark>', '</mark>', '…', 24) AS snip, \
         bm25(session_summaries_fts) AS score \
         FROM session_summaries_fts \
         JOIN session_summaries s ON s.id = session_summaries_fts.rowid \
         WHERE session_summaries_fts MATCH ?{} \
         ORDER BY score \
         LIMIT ?",
        proj_and
    );

    let mut params: Vec<rusqlite::types::Value> = Vec::with_capacity(proj_params.len() + 2);
    params.push(q.to_string().into());
    for p in &proj_params {
        params.push(p.clone().into());
    }
    params.push(rusqlite::types::Value::Integer(limit.clamp(1, 200) as i64));

    let mut stmt = conn.prepare(&sql).map_err(|e| format!("prepare: {e}"))?;
    let hits = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |r| {
            let id: i64 = r.get(0)?;
            let project: String = r.get(1)?;
            let request: Option<String> = r.get(2)?;
            let investigated: Option<String> = r.get(3)?;
            let learned: Option<String> = r.get(4)?;
            let completed: Option<String> = r.get(5)?;
            let next_steps: Option<String> = r.get(6)?;
            let notes: Option<String> = r.get(7)?;
            let created_at: String = r.get(8)?;
            let created_at_epoch: i64 = r.get(9)?;
            let snip: String = r.get(10)?;
            let score: f64 = r.get(11)?;
            let title_hint = first_nonempty_line(&[
                &request,
                &learned,
                &completed,
                &investigated,
                &next_steps,
                &notes,
            ]);
            Ok(SearchHit {
                id,
                kind: "summary".to_string(),
                project,
                created_at,
                created_at_epoch,
                title_hint,
                snippet_html: snip,
                score,
                channel: "fts".to_string(),
            })
        })
        .map_err(|e| format!("query_map: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect: {e}"))?;
    Ok(hits)
}

fn fts_search_observations(
    conn: &Connection,
    q: &str,
    filter: &[String],
    limit: u32,
) -> Result<Vec<SearchHit>, String> {
    let (proj_where, proj_params) = build_project_where(filter);
    let proj_and = if proj_where.is_empty() {
        String::new()
    } else {
        format!(" AND {}", &proj_where[" WHERE ".len()..])
    };
    // observations_fts 컬럼: title, subtitle, narrative, text, facts, concepts
    let sql = format!(
        "SELECT o.id, o.project, o.title, o.subtitle, o.narrative, o.text, o.facts, o.concepts, \
         o.created_at, o.created_at_epoch, \
         snippet(observations_fts, -1, '<mark>', '</mark>', '…', 24) AS snip, \
         bm25(observations_fts) AS score \
         FROM observations_fts \
         JOIN observations o ON o.id = observations_fts.rowid \
         WHERE observations_fts MATCH ?{} \
         ORDER BY score \
         LIMIT ?",
        proj_and
    );

    let mut params: Vec<rusqlite::types::Value> = Vec::with_capacity(proj_params.len() + 2);
    params.push(q.to_string().into());
    for p in &proj_params {
        params.push(p.clone().into());
    }
    params.push(rusqlite::types::Value::Integer(limit.clamp(1, 200) as i64));

    let mut stmt = conn.prepare(&sql).map_err(|e| format!("prepare: {e}"))?;
    let hits = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |r| {
            let id: i64 = r.get(0)?;
            let project: String = r.get(1)?;
            let title: Option<String> = r.get(2)?;
            let subtitle: Option<String> = r.get(3)?;
            let narrative: Option<String> = r.get(4)?;
            let text: Option<String> = r.get(5)?;
            let facts: Option<String> = r.get(6)?;
            let concepts: Option<String> = r.get(7)?;
            let created_at: String = r.get(8)?;
            let created_at_epoch: i64 = r.get(9)?;
            let snip: String = r.get(10)?;
            let score: f64 = r.get(11)?;
            let title_hint = first_nonempty_line(&[
                &title, &subtitle, &narrative, &text, &facts, &concepts,
            ]);
            Ok(SearchHit {
                id,
                kind: "observation".to_string(),
                project,
                created_at,
                created_at_epoch,
                title_hint,
                snippet_html: snip,
                score,
                channel: "fts".to_string(),
            })
        })
        .map_err(|e| format!("query_map: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect: {e}"))?;
    Ok(hits)
}

#[derive(Debug, Serialize)]
pub struct PreviewBreakdown {
    pub total_candidates: usize,
    pub already_exported: usize,
    pub new_count: usize,
}

/// summary / observation 별로 분리된 preview 결과.
/// `include_*=false`인 쪽은 모두 0으로 채워 반환 (UI 일관 처리용).
#[derive(Debug, Serialize)]
pub struct PreviewReport {
    pub summaries: PreviewBreakdown,
    pub observations: PreviewBreakdown,
}

/// `_memories/{YYYY-MM}/**/*.md`만 스캔 (observations/ 디렉토리 제외).
/// session_summary 노트의 mem_id 집합 반환. summary export 시 skip 판정용.
fn scan_existing_summary_ids(vault_root: &Path) -> Result<HashSet<i64>, String> {
    let mut ids: HashSet<i64> = HashSet::new();
    let mem_root = vault_root.join("_memories");
    if !mem_root.is_dir() {
        return Ok(ids);
    }
    let rd = fs::read_dir(&mem_root).map_err(|e| format!("read_dir {}: {e}", mem_root.display()))?;
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            // observations/ 디렉토리는 별 PK space — summary scan에서 제외.
            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if name == "observations" {
                continue;
            }
            walk_collect_mem_ids(&p, &mut ids)?;
        } else if p.extension().and_then(|s| s.to_str()) == Some("md") {
            // _memories/ 직속 .md (예외 케이스) 도 포함.
            if let Some(id) = peek_mem_id(&p) {
                ids.insert(id);
            }
        }
    }
    Ok(ids)
}

/// `_memories/observations/**/*.md`만 스캔. observation 노트의 mem_id 집합 반환.
fn scan_existing_observation_ids(vault_root: &Path) -> Result<HashSet<i64>, String> {
    let mut ids: HashSet<i64> = HashSet::new();
    let obs_root = vault_root.join("_memories").join("observations");
    if !obs_root.is_dir() {
        return Ok(ids);
    }
    walk_collect_mem_ids(&obs_root, &mut ids)?;
    Ok(ids)
}

fn walk_collect_mem_ids(dir: &Path, ids: &mut HashSet<i64>) -> Result<(), String> {
    let rd = fs::read_dir(dir).map_err(|e| format!("read_dir {}: {e}", dir.display()))?;
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            walk_collect_mem_ids(&p, ids)?;
        } else if p.extension().and_then(|s| s.to_str()) == Some("md") {
            if let Some(id) = peek_mem_id(&p) {
                ids.insert(id);
            }
        }
    }
    Ok(())
}

/// 주어진 (mem_id, kind) 페어에 해당하는 export된 노트의 절대 경로를 vault에서 찾는다.
/// 검색 결과 클릭 시 점프용. 없으면 Ok(None).
///
/// `kind`:
/// - `"summary"` → `_memories/{YYYY-MM}/**` walk (observations/ 디렉토리 제외)
/// - `"observation"` → `_memories/observations/{YYYY-MM}/**` walk
///
/// session_summaries.id와 observations.id는 별 PK space라 kind 인자로 분기 필수.
#[tauri::command]
pub fn memory_find_exported_note(
    vault_path: String,
    mem_id: i64,
    kind: String,
) -> Result<Option<String>, String> {
    let vault_root = PathBuf::from(&vault_path);
    if !vault_root.is_dir() {
        return Err(format!("vault not a directory: {vault_path}"));
    }
    let mem_root = vault_root.join("_memories");
    if !mem_root.is_dir() {
        return Ok(None);
    }
    match kind.as_str() {
        "summary" => find_summary_by_mem_id(&mem_root, mem_id),
        "observation" => {
            let obs_root = mem_root.join("observations");
            if !obs_root.is_dir() {
                return Ok(None);
            }
            find_note_by_mem_id(&obs_root, mem_id)
        }
        other => Err(format!(
            "invalid kind: {other} (expected 'summary' | 'observation')"
        )),
    }
}

/// `_memories/` 직속 자식 디렉토리에서 observations/는 제외하고 mem_id 매칭 .md 검색.
fn find_summary_by_mem_id(mem_root: &Path, target: i64) -> Result<Option<String>, String> {
    let rd =
        fs::read_dir(mem_root).map_err(|e| format!("read_dir {}: {e}", mem_root.display()))?;
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if name == "observations" {
                continue;
            }
            if let Some(found) = find_note_by_mem_id(&p, target)? {
                return Ok(Some(found));
            }
        } else if p.extension().and_then(|s| s.to_str()) == Some("md") {
            if peek_mem_id(&p) == Some(target) {
                return Ok(Some(p.to_string_lossy().to_string()));
            }
        }
    }
    Ok(None)
}

fn find_note_by_mem_id(dir: &Path, target: i64) -> Result<Option<String>, String> {
    let rd = fs::read_dir(dir).map_err(|e| format!("read_dir {}: {e}", dir.display()))?;
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            if let Some(found) = find_note_by_mem_id(&p, target)? {
                return Ok(Some(found));
            }
        } else if p.extension().and_then(|s| s.to_str()) == Some("md") {
            if peek_mem_id(&p) == Some(target) {
                return Ok(Some(p.to_string_lossy().to_string()));
            }
        }
    }
    Ok(None)
}

/// `vault_root/_memories/{YYYY-MM}/*.md` 안에서 mem_id 매칭 노트 절대 경로 (observations/ 제외).
/// mirror.rs PR2 #12 `cleanup_md_after_delete`에서 사용.
pub fn find_summary_md_by_mem_id(vault_root: &Path, target: i64) -> Result<Option<String>, String> {
    let mem_root = vault_root.join("_memories");
    if !mem_root.exists() {
        return Ok(None);
    }
    find_summary_by_mem_id(&mem_root, target)
}

/// `vault_root/_memories/observations/{YYYY-MM}/*.md` 안에서 mem_id 매칭 노트.
pub fn find_observation_md_by_mem_id(
    vault_root: &Path,
    target: i64,
) -> Result<Option<String>, String> {
    let obs_root = vault_root.join("_memories").join("observations");
    if !obs_root.exists() {
        return Ok(None);
    }
    find_note_by_mem_id(&obs_root, target)
}

/// 노트 frontmatter에서 `content_hash` 추출. peek_mem_id와 동일 패턴 (head 4KB).
pub fn peek_content_hash(path: &Path) -> Option<String> {
    let f = fs::File::open(path).ok()?;
    let mut buf = vec![0u8; 4 * 1024];
    let n = f.take(4 * 1024).read(&mut buf).ok()?;
    // UTF-8 multi-byte 경계 잘림 대응 — 5.1.d 학습 적용.
    let head = String::from_utf8_lossy(&buf[..n]);
    for line in head.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("content_hash:") {
            let value = rest.trim().trim_matches('"').trim_matches('\'');
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

/// 메모리 노트 메타 — 사이드 패널 "관련 메모리"용.
#[derive(Debug, Serialize, Clone)]
pub struct RelatedMemory {
    pub mem_id: i64,
    /// "summary" | "observation" — UI 배지 분기용.
    /// Rust 예약어 회피로 필드명은 kind, JSON 측엔 `type`으로 노출.
    #[serde(rename = "type")]
    pub kind: String,
    pub abs_path: String,
    pub title_hint: String,
    pub project: String,
    pub date: String,
    /// "files_read" / "files_edited" / "files_modified" / "both" / "body"
    pub matched_in: String,
}

/// 현재 노트와 관련된 메모리 노트를 vault `_memories/**`에서 찾는다.
/// 매칭 기준: 메모리 노트의 frontmatter `files_read` / `files_edited`에 현재 노트의 **basename**이 포함.
/// 더 정확한 매칭(부모 디렉토리 포함)이 필요하면 후속 옵션.
#[tauri::command]
pub fn memory_related_to_note(
    vault_path: String,
    note_abs_path: String,
) -> Result<Vec<RelatedMemory>, String> {
    let vault = PathBuf::from(&vault_path);
    if !vault.is_dir() {
        return Err(format!("vault not a directory: {vault_path}"));
    }
    let mem_root = vault.join("_memories");
    if !mem_root.is_dir() {
        return Ok(Vec::new());
    }
    // 현재 노트가 _memories/** 하위면 매칭 무의미 (메모리 노트끼리 cross-link는 본 phase 범위 밖)
    let note_path = PathBuf::from(&note_abs_path);
    if note_path.starts_with(&mem_root) {
        return Ok(Vec::new());
    }
    let basename = note_path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "invalid note path".to_string())?
        .to_string();
    if basename.is_empty() {
        return Ok(Vec::new());
    }
    let mut hits = Vec::new();
    walk_related(&mem_root, &basename, &mut hits)?;
    // 1차: matched_in 강도 (정확 매치 우선) — 2차: date desc.
    // 정확 매치(read/edited/modified/both)가 약한 매치(body)보다 위로.
    hits.sort_by(|a, b| {
        matched_in_rank(&a.matched_in)
            .cmp(&matched_in_rank(&b.matched_in))
            .then_with(|| b.date.cmp(&a.date))
    });
    Ok(hits)
}

/// matched_in 강도 점수 — 낮을수록 강한 신호.
fn matched_in_rank(s: &str) -> u8 {
    match s {
        "both" => 0,
        "files_modified" | "files_edited" => 1,
        "files_read" => 2,
        "body" => 3,
        _ => 4,
    }
}

fn walk_related(
    dir: &Path,
    basename: &str,
    out: &mut Vec<RelatedMemory>,
) -> Result<(), String> {
    let rd = fs::read_dir(dir).map_err(|e| format!("read_dir {}: {e}", dir.display()))?;
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            walk_related(&p, basename, out)?;
        } else if p.extension().and_then(|s| s.to_str()) == Some("md") {
            if let Some(rel) = peek_related(&p, basename) {
                out.push(rel);
            }
        }
    }
    Ok(())
}

/// 메모리 노트의 frontmatter + 본문에서 basename 매칭 검사.
/// - frontmatter의 `files_read` / `files_edited` / `files_modified` 값 (정확 매칭, 강한 신호)
/// - 본문 — 약한 신호. session_summaries.files_*가 NULL이라 본문 매칭이 주요 채널이었음 (PR2).
///   PR3부터 observations export로 정확 매치(files_read 6911건/files_modified 3060건)가 surface됨.
/// 너무 짧은 basename(<3자)은 false positive 다수 → 매치 안 함.
/// 첫 ~32KB만 읽어 비용 제한.
fn peek_related(path: &Path, basename: &str) -> Option<RelatedMemory> {
    if basename.len() < 3 {
        return None;
    }
    let f = fs::File::open(path).ok()?;
    let mut buf = vec![0u8; 32 * 1024];
    let n = f.take(32 * 1024).read(&mut buf).ok()?;
    // 32KB 경계에서 한국어 multi-byte 잘림 가능 — lossy로 안전 변환.
    // peek_mem_id와 동일 처리 (PR3 에러 259건 원인 fix).
    let head_owned = String::from_utf8_lossy(&buf[..n]).into_owned();
    let head = head_owned.as_str();
    let mut iter = head.splitn(3, "---\n");
    let _prefix = iter.next()?;
    let fm = iter.next()?;
    let body = iter.next().unwrap_or("");

    let mut mem_id: Option<i64> = None;
    let mut fm_type = String::new();
    let mut project = String::new();
    let mut date = String::new();
    let mut files_read = String::new();
    let mut files_edited = String::new();
    let mut files_modified = String::new();
    for line in fm.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("mem_id:") {
            mem_id = rest.trim().trim_matches('"').parse::<i64>().ok();
        } else if let Some(rest) = trimmed.strip_prefix("type:") {
            fm_type = rest.trim().trim_matches('"').to_string();
        } else if let Some(rest) = trimmed.strip_prefix("project:") {
            project = rest.trim().trim_matches('"').to_string();
        } else if let Some(rest) = trimmed.strip_prefix("date:") {
            date = rest.trim().trim_matches('"').to_string();
        } else if let Some(rest) = trimmed.strip_prefix("files_read:") {
            files_read = rest.trim().trim_matches('"').to_string();
        } else if let Some(rest) = trimmed.strip_prefix("files_edited:") {
            files_edited = rest.trim().trim_matches('"').to_string();
        } else if let Some(rest) = trimmed.strip_prefix("files_modified:") {
            files_modified = rest.trim().trim_matches('"').to_string();
        }
    }

    let in_read = files_read.contains(basename);
    let in_edited = files_edited.contains(basename);
    let in_modified = files_modified.contains(basename);
    let in_body = body.contains(basename);
    if !in_read && !in_edited && !in_modified && !in_body {
        return None;
    }

    // 우선순위:
    //   read AND (edited OR modified) → "both"   (정확 매치 양쪽)
    //   modified                       → "files_modified"  (observation 우대)
    //   edited                         → "files_edited"    (summary 우대)
    //   read                           → "files_read"
    //   body                           → "body"            (약한 신호)
    let matched_in = if in_read && (in_edited || in_modified) {
        "both"
    } else if in_modified {
        "files_modified"
    } else if in_edited {
        "files_edited"
    } else if in_read {
        "files_read"
    } else {
        "body"
    };

    // kind 결정: frontmatter `type` 우선, 없으면 path 추론 (PR1 노트 호환).
    //   frontmatter "session_summary" → "summary", "observation" → "observation"
    //   path에 components "observations" 포함 → "observation", 아니면 "summary"
    let kind = if fm_type == "observation" {
        "observation".to_string()
    } else if fm_type == "session_summary" || !fm_type.is_empty() {
        "summary".to_string()
    } else if path.components().any(|c| c.as_os_str() == "observations") {
        "observation".to_string()
    } else {
        "summary".to_string()
    };

    // title hint: 본문의 첫 "# " 줄
    let mut title: Option<String> = None;
    for line in body.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("# ") {
            title = Some(rest.chars().take(120).collect());
            break;
        }
    }
    Some(RelatedMemory {
        mem_id: mem_id?,
        kind,
        abs_path: path.to_string_lossy().to_string(),
        title_hint: title.unwrap_or_else(|| format!("Memory {}", mem_id.unwrap_or(0))),
        project,
        date: if date.is_empty() {
            String::from("(no date)")
        } else {
            date
        },
        matched_in: matched_in.to_string(),
    })
}

/// 노트 frontmatter에서 `mem_id` 추출.
/// - buffer 4KB (1KB는 한국어 본문 + yaml block scalar 케이스에서 부족했음, PR3 에러 259건 원인)
/// - `from_utf8_lossy`로 multi-byte 경계 잘림 안전 처리 (`std::str::from_utf8`는 invalid 시 None 반환)
fn peek_mem_id(path: &Path) -> Option<i64> {
    let f = fs::File::open(path).ok()?;
    let mut buf = vec![0u8; 4 * 1024];
    let n = f.take(4 * 1024).read(&mut buf).ok()?;
    // UTF-8 multi-byte 경계 잘림 대응 — invalid sequence는 U+FFFD로 대체. mem_id 라인 자체는 ASCII라 영향 X.
    let head = String::from_utf8_lossy(&buf[..n]);
    for line in head.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("mem_id:") {
            let value = rest.trim().trim_matches('"').trim_matches('\'');
            if let Ok(id) = value.parse::<i64>() {
                return Some(id);
            }
        }
    }
    None
}

/// summary / observation 각각의 preview 카운트를 분리해 반환.
/// `include_*=false`인 쪽은 0으로 채움 — UI는 항상 양쪽 카운트를 표시.
#[tauri::command]
pub fn memory_preview_export(
    vault_path: String,
    filter: Vec<String>,
    include_summaries: bool,
    include_observations: bool,
) -> Result<PreviewReport, String> {
    let vault_root = PathBuf::from(&vault_path);
    if !vault_root.is_dir() {
        return Err(format!("vault not a directory: {vault_path}"));
    }

    let summaries = if include_summaries {
        let candidates = list_summaries_inner(&filter)?;
        let existing = scan_existing_summary_ids(&vault_root)?;
        let already = candidates
            .iter()
            .filter(|s| existing.contains(&s.id))
            .count();
        PreviewBreakdown {
            total_candidates: candidates.len(),
            already_exported: already,
            new_count: candidates.len() - already,
        }
    } else {
        PreviewBreakdown {
            total_candidates: 0,
            already_exported: 0,
            new_count: 0,
        }
    };

    let observations = if include_observations {
        let candidates = list_observations_inner(&filter)?;
        let existing = scan_existing_observation_ids(&vault_root)?;
        let already = candidates
            .iter()
            .filter(|o| existing.contains(&o.id))
            .count();
        PreviewBreakdown {
            total_candidates: candidates.len(),
            already_exported: already,
            new_count: candidates.len() - already,
        }
    } else {
        PreviewBreakdown {
            total_candidates: 0,
            already_exported: 0,
            new_count: 0,
        }
    };

    Ok(PreviewReport {
        summaries,
        observations,
    })
}

#[derive(Debug, Serialize)]
pub struct ExportBreakdown {
    pub created: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
    pub total_candidates: usize,
}

impl ExportBreakdown {
    fn empty() -> Self {
        Self {
            created: 0,
            skipped: 0,
            errors: Vec::new(),
            total_candidates: 0,
        }
    }
}

/// summary / observation 각각의 export 결과 분리.
#[derive(Debug, Serialize)]
pub struct ExportReport {
    pub summaries: ExportBreakdown,
    pub observations: ExportBreakdown,
}

/// Sync I/O + emit 작업을 main IPC thread 밖으로 격리.
/// 격리하지 않으면 sync `#[tauri::command]` 내부의 emit이 webview에 즉시 도달하지 못하고
/// invoke 응답 큐에 막혀 export 완료 후 한꺼번에 도착 → progress UI가 안 보임.
#[tauri::command]
pub async fn memory_export_to_vault(
    app: AppHandle,
    vault_path: String,
    filter: Vec<String>,
    include_summaries: bool,
    include_observations: bool,
) -> Result<ExportReport, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<ExportReport, String> {
        let vault_root = PathBuf::from(&vault_path);
        if !vault_root.is_dir() {
            return Err(format!("vault not a directory: {vault_path}"));
        }
        // exported_at 한 번만 계산 (sync 한 회 = 동일 timestamp, summary/observation 공유)
        let exported_at = current_iso8601();

        let summaries = if include_summaries {
            let rows = list_summaries_inner(&filter)?;
            let existing = scan_existing_summary_ids(&vault_root)?;
            let total = rows.len();
            let mut created = 0usize;
            let mut skipped = 0usize;
            let mut errors: Vec<String> = Vec::new();
            // 시작 알림 (total 노출 + UI를 0% 상태로 표시)
            emit_progress(&app, "summary", 0, total, 0, 0, 0);
            for (i, s) in rows.iter().enumerate() {
                if existing.contains(&s.id) {
                    skipped += 1;
                } else {
                    match write_summary_to_vault(&vault_root, s, &exported_at) {
                        Ok(_) => created += 1,
                        Err(e) => errors.push(format!("mem_id={}: {e}", s.id)),
                    }
                }
                let next = i + 1;
                // EMIT_EVERY 주기 + 마지막 row 보장
                if next % EMIT_EVERY == 0 || next == total {
                    emit_progress(&app, "summary", next, total, created, skipped, errors.len());
                }
            }
            ExportBreakdown {
                created,
                skipped,
                errors,
                total_candidates: total,
            }
        } else {
            ExportBreakdown::empty()
        };

        let observations = if include_observations {
            let rows = list_observations_inner(&filter)?;
            let existing = scan_existing_observation_ids(&vault_root)?;
            let total = rows.len();
            let mut created = 0usize;
            let mut skipped = 0usize;
            let mut errors: Vec<String> = Vec::new();
            emit_progress(&app, "observation", 0, total, 0, 0, 0);
            for (i, o) in rows.iter().enumerate() {
                if existing.contains(&o.id) {
                    skipped += 1;
                } else {
                    match write_observation_to_vault(&vault_root, o, &exported_at) {
                        Ok(_) => created += 1,
                        Err(e) => errors.push(format!("obs_id={}: {e}", o.id)),
                    }
                }
                let next = i + 1;
                if next % EMIT_EVERY == 0 || next == total {
                    emit_progress(
                        &app,
                        "observation",
                        next,
                        total,
                        created,
                        skipped,
                        errors.len(),
                    );
                }
            }
            ExportBreakdown {
                created,
                skipped,
                errors,
                total_candidates: total,
            }
        } else {
            ExportBreakdown::empty()
        };

        Ok(ExportReport {
            summaries,
            observations,
        })
    })
    .await
    .map_err(|e| format!("spawn_blocking join: {e}"))?
}

/// observation 한 row를 `_memories/observations/{YYYY-MM}/{date}-{project}-{obs_id}.md`로 작성.
/// session_summary와 동일 패턴(같은 헬퍼 재사용)이지만 폴더가 분리되어 mem_id 충돌 회피.
fn write_observation_to_vault(
    vault_root: &Path,
    o: &Observation,
    exported_at: &str,
) -> Result<(), String> {
    let yyyy_mm = month_folder(&o.created_at, o.created_at_epoch);
    let safe_project = sanitize_project_for_path(&o.project);
    let date_part = date_only(&o.created_at, o.created_at_epoch);
    let filename = format!("{date_part}-{safe_project}-{}.md", o.id);

    let dir = vault_root
        .join("_memories")
        .join("observations")
        .join(&yyyy_mm);
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all {}: {e}", dir.display()))?;
    let target = dir.join(&filename);
    if target.exists() {
        return Err(format!("target already exists: {}", target.display()));
    }
    let body = render_observation_md(o, exported_at);
    fs::write(&target, body).map_err(|e| format!("write {}: {e}", target.display()))?;
    Ok(())
}

/// observation 노트 본문(frontmatter + body).
/// frontmatter `type: observation` + `obs_type` (observations.type 컬럼 값).
fn render_observation_md(o: &Observation, exported_at: &str) -> String {
    let mut out = String::with_capacity(4096);
    // content_hash: claude-mem 측 값이 있으면 그대로, 없으면 Lapis 계산 — mirror sync와 일관.
    let hash = o
        .content_hash
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            mirror::hash_observation(&o.text, &o.subtitle, &o.facts, &o.narrative, &o.concepts)
        });
    // frontmatter
    out.push_str("---\n");
    out.push_str("doc_kind: memory\n");
    out.push_str("type: observation\n");
    out.push_str("source: claude-mem\n");
    out.push_str(&format!("mem_id: {}\n", o.id));
    out.push_str(&format!(
        "mem_session_id: \"{}\"\n",
        o.memory_session_id.replace('"', "\\\"")
    ));
    out.push_str(&format!("project: \"{}\"\n", o.project.replace('"', "\\\"")));
    out.push_str(&format!(
        "obs_type: \"{}\"\n",
        o.r#type.replace('"', "\\\"")
    ));
    out.push_str(&format!("date: \"{}\"\n", o.created_at));
    if let Some(fr) = &o.files_read {
        out.push_str(&format!("files_read: {}\n", yaml_block_scalar(fr)));
    }
    if let Some(fm) = &o.files_modified {
        out.push_str(&format!("files_modified: {}\n", yaml_block_scalar(fm)));
    }
    out.push_str(&format!("content_hash: \"{hash}\"\n"));
    out.push_str(&format!("exported_at: \"{exported_at}\"\n"));
    out.push_str("exported_by: lapis-phase-5.2.b\n");
    out.push_str("---\n\n");

    // 본문 — title fallback "Observation {id}"
    let default_title = format!("Observation {}", o.id);
    let title = o
        .title
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(&default_title);
    out.push_str(&format!("# {title}\n\n"));
    if let Some(sub) = &o.subtitle {
        let t = sub.trim();
        if !t.is_empty() {
            out.push_str(t);
            out.push_str("\n\n");
        }
    }
    push_section(&mut out, "Text", &o.text);
    push_section(&mut out, "Narrative", &o.narrative);
    push_section(&mut out, "Facts", &o.facts);
    push_section(&mut out, "Concepts", &o.concepts);
    out
}

fn write_summary_to_vault(
    vault_root: &Path,
    s: &SessionSummary,
    exported_at: &str,
) -> Result<(), String> {
    let yyyy_mm = month_folder(&s.created_at, s.created_at_epoch);
    let safe_project = sanitize_project_for_path(&s.project);
    let date_part = date_only(&s.created_at, s.created_at_epoch);
    let filename = format!("{date_part}-{safe_project}-{}.md", s.id);

    let dir = vault_root.join("_memories").join(&yyyy_mm);
    fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all {}: {e}", dir.display()))?;
    let target = dir.join(&filename);
    if target.exists() {
        // 매우 드문 케이스 (같은 mem_id 다른 위치). skip 처리.
        return Err(format!("target already exists: {}", target.display()));
    }
    let body = render_summary_md(s, exported_at);
    fs::write(&target, body).map_err(|e| format!("write {}: {e}", target.display()))?;
    Ok(())
}

fn render_summary_md(s: &SessionSummary, exported_at: &str) -> String {
    let mut out = String::with_capacity(4096);
    // content_hash: summary는 claude-mem 측에 컬럼 없음 → 항상 Lapis 계산 (mirror sync와 동일 함수).
    let hash = mirror::hash_summary(
        &s.request,
        &s.investigated,
        &s.learned,
        &s.completed,
        &s.next_steps,
        &s.notes,
    );
    // frontmatter
    out.push_str("---\n");
    out.push_str("doc_kind: memory\n");
    // type 필드: PR3에서 observation과 분기 — PR1 시점에 export된 노트는 이 필드 없음(default 추론으로 호환).
    out.push_str("type: session_summary\n");
    out.push_str("source: claude-mem\n");
    out.push_str(&format!("mem_id: {}\n", s.id));
    out.push_str(&format!(
        "mem_session_id: \"{}\"\n",
        s.memory_session_id.replace('"', "\\\"")
    ));
    out.push_str(&format!("project: \"{}\"\n", s.project.replace('"', "\\\"")));
    out.push_str(&format!("date: \"{}\"\n", s.created_at));
    if let Some(fr) = &s.files_read {
        out.push_str(&format!("files_read: {}\n", yaml_block_scalar(fr)));
    }
    if let Some(fe) = &s.files_edited {
        out.push_str(&format!("files_edited: {}\n", yaml_block_scalar(fe)));
    }
    out.push_str(&format!("content_hash: \"{hash}\"\n"));
    out.push_str(&format!("exported_at: \"{exported_at}\"\n"));
    out.push_str("exported_by: lapis-phase-5.2.b\n");
    out.push_str("---\n\n");
    // 본문
    out.push_str(&format!(
        "# Session Summary — {} / {}\n\n",
        s.project, s.created_at
    ));
    push_section(&mut out, "Request", &s.request);
    push_section(&mut out, "Investigated", &s.investigated);
    push_section(&mut out, "Learned", &s.learned);
    push_section(&mut out, "Completed", &s.completed);
    push_section(&mut out, "Next steps", &s.next_steps);
    push_section(&mut out, "Notes", &s.notes);
    out
}

fn push_section(out: &mut String, title: &str, content: &Option<String>) {
    if let Some(c) = content {
        let trimmed = c.trim();
        if trimmed.is_empty() {
            return;
        }
        out.push_str(&format!("## {title}\n\n{trimmed}\n\n"));
    }
}

/// JSON 배열이거나 멀티라인일 수 있는 raw 문자열을 yaml block scalar로.
/// 단순 single-line인 경우 따옴표 string으로, 멀티라인이면 `|` 블록으로.
fn yaml_block_scalar(raw: &str) -> String {
    if !raw.contains('\n') && !raw.contains('\r') {
        // JSON 배열 문자열 등 single line은 그대로 (yaml flow scalar로 인식되도록)
        // 따옴표 escape 후 double-quoted string으로.
        format!("\"{}\"", raw.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        let mut s = String::from("|\n");
        for line in raw.lines() {
            s.push_str("  ");
            s.push_str(line);
            s.push('\n');
        }
        s.trim_end_matches('\n').to_string()
    }
}

/// 경로용 project 정규화 — `/`, 공백 등을 `-`로.
fn sanitize_project_for_path(project: &str) -> String {
    project
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

/// `created_at` 컬럼 우선, 빈 값이면 epoch fallback. YYYY-MM 추출.
fn month_folder(created_at: &str, epoch: i64) -> String {
    if created_at.len() >= 7 {
        // ISO 8601 가정: "2026-05-12T..."
        return created_at[..7].to_string();
    }
    let dt = epoch_to_naive(epoch);
    format!("{:04}-{:02}", dt.0, dt.1)
}

fn date_only(created_at: &str, epoch: i64) -> String {
    if created_at.len() >= 10 {
        return created_at[..10].to_string();
    }
    let dt = epoch_to_naive(epoch);
    format!("{:04}-{:02}-{:02}", dt.0, dt.1, dt.2)
}

/// epoch sec → (year, month, day). 외부 crate 회피 — Gregorian 단순 계산 (UTC).
fn epoch_to_naive(epoch: i64) -> (i32, u32, u32) {
    // days since 1970-01-01
    let secs = epoch.max(0);
    let days = (secs / 86400) as i64;
    // Howard Hinnant's date algorithm (civil_from_days)
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let yy = (y + if m <= 2 { 1 } else { 0 }) as i32;
    (yy, m, d)
}

/// 현재 시각을 ISO 8601 UTC 문자열로. 외부 crate 회피.
fn current_iso8601() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, m, d) = epoch_to_naive(now);
    let rem = (now % 86400).max(0) as u32;
    let h = rem / 3600;
    let mi = (rem % 3600) / 60;
    let s = rem % 60;
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

