use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

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
/// - ["Lapis", "MyProject"] → `(project = 'Lapis' OR project LIKE 'Lapis/%' OR project = 'MyProject' OR project LIKE 'MyProject/%')`
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

#[derive(Debug, Serialize)]
pub struct SearchHit {
    pub id: i64,
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

#[tauri::command]
pub fn memory_fts_search(
    query: String,
    filter: Vec<String>,
    limit: u32,
) -> Result<Vec<SearchHit>, String> {
    let q = sanitize_fts_query(&query);
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let conn = open_ro()?;
    let (proj_where, proj_params) = build_project_where(&filter);
    // proj_where는 " WHERE (...)" 또는 빈 문자열. 우리는 MATCH 뒤에 AND로 붙여야 하므로 변환.
    let proj_and = if proj_where.is_empty() {
        String::new()
    } else {
        format!(" AND {}", &proj_where[" WHERE ".len()..])
    };
    // 모든 placeholder는 unnumbered `?` — rusqlite는 위치 기반으로 바인딩.
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

    // 파라미터: query, project_params..., limit
    let mut params: Vec<rusqlite::types::Value> = Vec::with_capacity(proj_params.len() + 2);
    params.push(q.into());
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
pub struct PreviewReport {
    pub total_candidates: usize,
    pub already_exported: usize,
    pub new_count: usize,
}

/// `_memories/**/*.md`를 재귀 스캔해 frontmatter에서 mem_id 추출. 첫 ~1KB만 읽어 빠르게.
fn scan_existing_mem_ids(vault_root: &Path) -> Result<HashSet<i64>, String> {
    let mut ids: HashSet<i64> = HashSet::new();
    let mem_root = vault_root.join("_memories");
    if !mem_root.is_dir() {
        return Ok(ids);
    }
    walk_collect_mem_ids(&mem_root, &mut ids)?;
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

/// 주어진 mem_id에 해당하는 export된 노트의 절대 경로를 vault에서 찾는다.
/// 검색 결과 클릭 시 점프용. 없으면 Ok(None).
#[tauri::command]
pub fn memory_find_exported_note(
    vault_path: String,
    mem_id: i64,
) -> Result<Option<String>, String> {
    let vault_root = PathBuf::from(&vault_path);
    if !vault_root.is_dir() {
        return Err(format!("vault not a directory: {vault_path}"));
    }
    let mem_root = vault_root.join("_memories");
    if !mem_root.is_dir() {
        return Ok(None);
    }
    find_note_by_mem_id(&mem_root, mem_id)
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

/// 메모리 노트 메타 — 사이드 패널 "관련 메모리"용.
#[derive(Debug, Serialize, Clone)]
pub struct RelatedMemory {
    pub mem_id: i64,
    pub abs_path: String,
    pub title_hint: String,
    pub project: String,
    pub date: String,
    pub matched_in: String, // "files_read" / "files_edited" / "both"
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
    // 최신순 정렬
    hits.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(hits)
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
/// - frontmatter의 `files_read` / `files_edited` 값 (정확 매칭, 강한 신호)
/// - 본문 (request/investigated/learned/completed/next_steps/notes) — 약한 신호이나
///   session_summaries는 files_* 컬럼이 거의 NULL이라 본문 매칭이 사실상 주요 채널.
/// 너무 짧은 basename(<3자)은 false positive가 너무 많아 매치 안 함.
/// 첫 ~32KB만 읽어 비용 제한.
fn peek_related(path: &Path, basename: &str) -> Option<RelatedMemory> {
    if basename.len() < 3 {
        return None;
    }
    let f = fs::File::open(path).ok()?;
    let mut buf = vec![0u8; 32 * 1024];
    let n = f.take(32 * 1024).read(&mut buf).ok()?;
    let head = std::str::from_utf8(&buf[..n]).ok()?;
    let mut iter = head.splitn(3, "---\n");
    let _prefix = iter.next()?;
    let fm = iter.next()?;
    let body = iter.next().unwrap_or("");

    let mut mem_id: Option<i64> = None;
    let mut project = String::new();
    let mut date = String::new();
    let mut files_read = String::new();
    let mut files_edited = String::new();
    for line in fm.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("mem_id:") {
            mem_id = rest.trim().trim_matches('"').parse::<i64>().ok();
        } else if let Some(rest) = trimmed.strip_prefix("project:") {
            project = rest.trim().trim_matches('"').to_string();
        } else if let Some(rest) = trimmed.strip_prefix("date:") {
            date = rest.trim().trim_matches('"').to_string();
        } else if let Some(rest) = trimmed.strip_prefix("files_read:") {
            files_read = rest.trim().trim_matches('"').to_string();
        } else if let Some(rest) = trimmed.strip_prefix("files_edited:") {
            files_edited = rest.trim().trim_matches('"').to_string();
        }
    }

    let in_read = files_read.contains(basename);
    let in_edited = files_edited.contains(basename);
    let in_body = body.contains(basename);
    if !in_read && !in_edited && !in_body {
        return None;
    }

    // 우선순위: both > files_edited > files_read > body
    let matched_in = if in_read && in_edited {
        "both"
    } else if in_edited {
        "files_edited"
    } else if in_read {
        "files_read"
    } else {
        "body"
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

fn peek_mem_id(path: &Path) -> Option<i64> {
    let f = fs::File::open(path).ok()?;
    let mut buf = vec![0u8; 1024];
    let n = f.take(1024).read(&mut buf).ok()?;
    let head = std::str::from_utf8(&buf[..n]).ok()?;
    // frontmatter 안의 `mem_id: <num>` 추출. 매우 단순한 정규식 회피 — 줄 단위 검사.
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

#[tauri::command]
pub fn memory_preview_export(
    vault_path: String,
    filter: Vec<String>,
) -> Result<PreviewReport, String> {
    let vault_root = PathBuf::from(&vault_path);
    if !vault_root.is_dir() {
        return Err(format!("vault not a directory: {vault_path}"));
    }
    let candidates = list_summaries_inner(&filter)?;
    let existing = scan_existing_mem_ids(&vault_root)?;
    let already = candidates
        .iter()
        .filter(|s| existing.contains(&s.id))
        .count();
    Ok(PreviewReport {
        total_candidates: candidates.len(),
        already_exported: already,
        new_count: candidates.len() - already,
    })
}

#[derive(Debug, Serialize)]
pub struct ExportReport {
    pub created: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
    pub total_candidates: usize,
}

#[tauri::command]
pub fn memory_export_to_vault(
    vault_path: String,
    filter: Vec<String>,
) -> Result<ExportReport, String> {
    let vault_root = PathBuf::from(&vault_path);
    if !vault_root.is_dir() {
        return Err(format!("vault not a directory: {vault_path}"));
    }
    let summaries = list_summaries_inner(&filter)?;
    let existing = scan_existing_mem_ids(&vault_root)?;

    let total = summaries.len();
    let mut created = 0usize;
    let mut skipped = 0usize;
    let mut errors: Vec<String> = Vec::new();

    // exported_at 한 번만 계산 (sync 한 회 = 동일 timestamp)
    let exported_at = current_iso8601();

    for s in &summaries {
        if existing.contains(&s.id) {
            skipped += 1;
            continue;
        }
        match write_summary_to_vault(&vault_root, s, &exported_at) {
            Ok(_) => created += 1,
            Err(e) => errors.push(format!("mem_id={}: {e}", s.id)),
        }
    }

    Ok(ExportReport {
        created,
        skipped,
        errors,
        total_candidates: total,
    })
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
    // frontmatter
    out.push_str("---\n");
    out.push_str("doc_kind: memory\n");
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
    out.push_str(&format!("exported_at: \"{exported_at}\"\n"));
    out.push_str("exported_by: lapis-phase-5.1.a\n");
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

