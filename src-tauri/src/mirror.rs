//! Lapis 자체 SQLite mirror DB + sync 엔진.
//!
//! claude-mem `claude-mem.db`를 read-only source로 잡고
//! Lapis 도메인 모델(`lapis-mem.db`)로 정규화한 mirror를 유지한다.
//!
//! PR1 단위 구성:
//! - #1: schema v1 + 초기 빌드 (`build_schema_v1` / `ensure_schema` / `open_rw`)
//! - #2: sync 엔진 inner — `sync_summaries` / `sync_observations`
//! - #3: 증분 sync — `sync_now(full=false)`가 `last_incremental_sync_at` 적용
//! - #4: hard delete — `sync_deletions` (셋 diff)
//! - #5 이후: Tauri commands는 lib.rs에서 wrapping
//!
//! schema 변경(v1→v2) 시 mirror 통째 재빌드를 호출자가 결정 (현재는 에러).

use rusqlite::{params, Connection, OpenFlags, OptionalExtension, Transaction};
use serde::Serialize;
use std::collections::HashSet;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::PathBuf;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

// ─── schema / open ──────────────────────────────────────────────────────────

/// mirror DB의 현재 schema 버전. v1 → v2 시 통째 재빌드 정책 (plan §2).
const SCHEMA_VERSION: i32 = 1;

/// claude-mem DB 파일명 (`~/.claude-mem/` 안 고정).
const CLAUDE_MEM_DB_FILENAME: &str = "claude-mem.db";

/// mirror DB 파일 경로 (`~/Library/Application Support/com.lapis.dev/lapis-mem.db`).
pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir 조회 실패: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("app_data_dir 생성 실패: {e}"))?;
    Ok(dir.join("lapis-mem.db"))
}

/// mirror DB 연결 (read-write) + schema 보장.
pub fn open_rw(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(&path).map_err(|e| format!("mirror DB open 실패: {e}"))?;

    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("PRAGMA journal_mode 실패: {e}"))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("PRAGMA foreign_keys 실패: {e}"))?;

    ensure_schema(&conn)?;
    Ok(conn)
}

/// `PRAGMA user_version`을 보고 필요 시 schema를 빌드한다.
fn ensure_schema(conn: &Connection) -> Result<(), String> {
    let current: i32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| format!("PRAGMA user_version 조회 실패: {e}"))?;

    if current == SCHEMA_VERSION {
        return Ok(());
    }
    if current == 0 {
        build_schema_v1(conn)?;
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(|e| format!("PRAGMA user_version 설정 실패: {e}"))?;
        return Ok(());
    }
    Err(format!(
        "lapis-mem.db schema 버전 불일치: 디스크={current}, 기대={SCHEMA_VERSION}. 재빌드 필요."
    ))
}

/// schema v1 빌드. 모든 CREATE는 `IF NOT EXISTS` — 부분 상태에서도 안전 복구.
fn build_schema_v1(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        BEGIN;

        CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY,
            kind TEXT NOT NULL CHECK(kind IN ('summary', 'observation')),
            source_id INTEGER NOT NULL,
            session_id TEXT NOT NULL,
            project TEXT NOT NULL,
            title TEXT,
            body TEXT NOT NULL,
            obs_type TEXT,
            content_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            created_at_epoch INTEGER NOT NULL,
            last_synced_at_epoch INTEGER NOT NULL,
            md_path TEXT,
            UNIQUE(kind, source_id)
        );

        CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
        CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
        CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at_epoch DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);

        CREATE TABLE IF NOT EXISTS files_mentioned (
            memory_id INTEGER NOT NULL,
            file_path TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('read', 'edited', 'modified')),
            PRIMARY KEY (memory_id, file_path, role),
            FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_files_path ON files_mentioned(file_path);

        CREATE TABLE IF NOT EXISTS tags (
            memory_id INTEGER NOT NULL,
            tag TEXT NOT NULL,
            PRIMARY KEY (memory_id, tag),
            FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS links_to_vault_notes (
            memory_id INTEGER NOT NULL,
            vault_note_path TEXT NOT NULL,
            match_role TEXT NOT NULL CHECK(match_role IN ('read', 'edited', 'modified', 'both')),
            PRIMARY KEY (memory_id, vault_note_path),
            FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_vault_note_path ON links_to_vault_notes(vault_note_path);

        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
            title, body,
            content='memories',
            content_rowid='id',
            tokenize='unicode61'
        );

        CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
            INSERT INTO memories_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
            INSERT INTO memories_fts(memories_fts, rowid, title, body)
            VALUES('delete', old.id, old.title, old.body);
        END;
        CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
            INSERT INTO memories_fts(memories_fts, rowid, title, body)
            VALUES('delete', old.id, old.title, old.body);
            INSERT INTO memories_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
        END;

        CREATE TABLE IF NOT EXISTS sync_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        INSERT OR IGNORE INTO sync_meta(key, value) VALUES
            ('last_full_sync_at', '0'),
            ('last_incremental_sync_at', '0'),
            ('schema_version', '1');

        COMMIT;
        "#,
    )
    .map_err(|e| format!("schema v1 빌드 실패: {e}"))
}

// ─── claude-mem source open ─────────────────────────────────────────────────

fn claude_mem_db_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|e| format!("HOME 미설정: {e}"))?;
    Ok(PathBuf::from(home)
        .join(".claude-mem")
        .join(CLAUDE_MEM_DB_FILENAME))
}

fn open_claude_mem_ro() -> Result<Connection, String> {
    let p = claude_mem_db_path()?;
    if !p.exists() {
        return Err(format!("claude-mem DB가 없습니다: {}", p.display()));
    }
    Connection::open_with_flags(
        &p,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("claude-mem DB open 실패: {e}"))
}

// ─── sync 엔진 ──────────────────────────────────────────────────────────────

/// sync 1회 결과. 모달/사이드바 status로 노출.
#[derive(Debug, Serialize, Clone, Default)]
pub struct SyncReport {
    pub full: bool,
    pub summaries_upserted: usize,
    pub observations_upserted: usize,
    pub deleted: usize,
    pub duration_ms: u128,
}

/// 풀 또는 증분 sync 1회.
///
/// - `full=true`: `last=0`부터 다시 훑음 (memories는 ON CONFLICT DO UPDATE이라 멱등).
/// - `full=false`: `sync_meta['last_incremental_sync_at']` 이후만.
///
/// 삭제는 항상 셋 diff로 감지 (`sync_deletions`). 비용은 ID 셋 2× 스캔 + diff — 11500 row면 ~수백 ms.
pub fn sync_now(app: &AppHandle, full: bool) -> Result<SyncReport, String> {
    let start = Instant::now();
    let mut report = SyncReport {
        full,
        ..Default::default()
    };

    let src = open_claude_mem_ro()?;
    let mut dst = open_rw(app)?;

    let last_epoch: i64 = if full {
        0
    } else {
        read_meta_i64(&dst, "last_incremental_sync_at")?.unwrap_or(0)
    };
    let now_epoch = now_epoch_s();

    let tx = dst
        .transaction()
        .map_err(|e| format!("mirror tx 시작 실패: {e}"))?;

    report.summaries_upserted = sync_summaries(&src, &tx, last_epoch, now_epoch)?;
    report.observations_upserted = sync_observations(&src, &tx, last_epoch, now_epoch)?;
    report.deleted = sync_deletions(&src, &tx)?;

    write_meta(&tx, "last_incremental_sync_at", &now_epoch.to_string())?;
    if full {
        write_meta(&tx, "last_full_sync_at", &now_epoch.to_string())?;
    }

    tx.commit()
        .map_err(|e| format!("mirror tx commit 실패: {e}"))?;

    report.duration_ms = start.elapsed().as_millis();
    Ok(report)
}

fn sync_summaries(
    src: &Connection,
    tx: &Transaction,
    last_epoch: i64,
    now_epoch: i64,
) -> Result<usize, String> {
    let mut stmt = src
        .prepare(
            "SELECT id, memory_session_id, project, request, investigated, learned, completed, \
                    next_steps, files_read, files_edited, notes, created_at, created_at_epoch \
             FROM session_summaries \
             WHERE merged_into_project IS NULL AND created_at_epoch > ?",
        )
        .map_err(|e| format!("summaries prepare 실패: {e}"))?;

    let mut rows = stmt
        .query([last_epoch])
        .map_err(|e| format!("summaries query 실패: {e}"))?;

    let mut count = 0usize;
    while let Some(row) = rows
        .next()
        .map_err(|e| format!("summaries next 실패: {e}"))?
    {
        let source_id: i64 = row.get(0).map_err(|e| format!("summary id: {e}"))?;
        let session_id: String = row.get(1).map_err(|e| format!("summary session: {e}"))?;
        let project: String = row.get(2).map_err(|e| format!("summary project: {e}"))?;
        let request: Option<String> = row.get(3).ok();
        let investigated: Option<String> = row.get(4).ok();
        let learned: Option<String> = row.get(5).ok();
        let completed: Option<String> = row.get(6).ok();
        let next_steps: Option<String> = row.get(7).ok();
        let files_read_json: Option<String> = row.get(8).ok();
        let files_edited_json: Option<String> = row.get(9).ok();
        let notes: Option<String> = row.get(10).ok();
        let created_at: String = row
            .get(11)
            .map_err(|e| format!("summary created_at: {e}"))?;
        let created_at_epoch: i64 =
            row.get(12).map_err(|e| format!("summary epoch: {e}"))?;

        let title = summary_title(&request);
        let body = build_summary_body(
            &request,
            &investigated,
            &learned,
            &completed,
            &next_steps,
            &notes,
        );
        let content_hash = hash_summary(
            &request,
            &investigated,
            &learned,
            &completed,
            &next_steps,
            &notes,
        );

        let memory_id = upsert_memory(
            tx,
            "summary",
            source_id,
            &session_id,
            &project,
            &title,
            &body,
            None,
            &content_hash,
            &created_at,
            created_at_epoch,
            now_epoch,
        )?;

        replace_files(tx, memory_id, &files_read_json, "read")?;
        replace_files_append(tx, memory_id, &files_edited_json, "edited")?;

        count += 1;
    }
    Ok(count)
}

fn sync_observations(
    src: &Connection,
    tx: &Transaction,
    last_epoch: i64,
    now_epoch: i64,
) -> Result<usize, String> {
    let mut stmt = src
        .prepare(
            "SELECT id, memory_session_id, project, text, type, title, subtitle, facts, \
                    narrative, concepts, files_read, files_modified, content_hash, created_at, created_at_epoch \
             FROM observations \
             WHERE merged_into_project IS NULL AND created_at_epoch > ?",
        )
        .map_err(|e| format!("observations prepare 실패: {e}"))?;

    let mut rows = stmt
        .query([last_epoch])
        .map_err(|e| format!("observations query 실패: {e}"))?;

    let mut count = 0usize;
    while let Some(row) = rows
        .next()
        .map_err(|e| format!("observations next 실패: {e}"))?
    {
        let source_id: i64 = row.get(0).map_err(|e| format!("obs id: {e}"))?;
        let session_id: String = row.get(1).map_err(|e| format!("obs session: {e}"))?;
        let project: String = row.get(2).map_err(|e| format!("obs project: {e}"))?;
        let text: Option<String> = row.get(3).ok();
        let obs_type: String = row.get(4).map_err(|e| format!("obs type: {e}"))?;
        let title_col: Option<String> = row.get(5).ok();
        let subtitle: Option<String> = row.get(6).ok();
        let facts: Option<String> = row.get(7).ok();
        let narrative: Option<String> = row.get(8).ok();
        let concepts: Option<String> = row.get(9).ok();
        let files_read_json: Option<String> = row.get(10).ok();
        let files_modified_json: Option<String> = row.get(11).ok();
        let claude_mem_hash: Option<String> = row.get(12).ok();
        let created_at: String = row.get(13).map_err(|e| format!("obs created_at: {e}"))?;
        let created_at_epoch: i64 = row.get(14).map_err(|e| format!("obs epoch: {e}"))?;

        let title = title_col
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "(no title)".to_string());
        let body = build_observation_body(&text, &subtitle, &facts, &narrative, &concepts);

        // claude-mem 측 content_hash가 있으면 그대로 사용. 없으면 Lapis 계산.
        let content_hash = claude_mem_hash
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| hash_observation(&text, &subtitle, &facts, &narrative, &concepts));

        let memory_id = upsert_memory(
            tx,
            "observation",
            source_id,
            &session_id,
            &project,
            &title,
            &body,
            Some(&obs_type),
            &content_hash,
            &created_at,
            created_at_epoch,
            now_epoch,
        )?;

        replace_files(tx, memory_id, &files_read_json, "read")?;
        replace_files_append(tx, memory_id, &files_modified_json, "modified")?;

        count += 1;
    }
    Ok(count)
}

/// `ON CONFLICT(kind, source_id) DO UPDATE` — `INSERT OR REPLACE`를 피해 자식 cascade 발생을 막는다.
/// `RETURNING id`로 신규/기존 모두 memory_id 회수.
fn upsert_memory(
    tx: &Transaction,
    kind: &str,
    source_id: i64,
    session_id: &str,
    project: &str,
    title: &str,
    body: &str,
    obs_type: Option<&str>,
    content_hash: &str,
    created_at: &str,
    created_at_epoch: i64,
    now_epoch: i64,
) -> Result<i64, String> {
    tx.query_row(
        "INSERT INTO memories(kind, source_id, session_id, project, title, body, obs_type, \
                              content_hash, created_at, created_at_epoch, last_synced_at_epoch) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(kind, source_id) DO UPDATE SET \
             session_id = excluded.session_id, \
             project = excluded.project, \
             title = excluded.title, \
             body = excluded.body, \
             obs_type = excluded.obs_type, \
             content_hash = excluded.content_hash, \
             created_at = excluded.created_at, \
             created_at_epoch = excluded.created_at_epoch, \
             last_synced_at_epoch = excluded.last_synced_at_epoch \
         RETURNING id",
        params![
            kind,
            source_id,
            session_id,
            project,
            title,
            body,
            obs_type,
            content_hash,
            created_at,
            created_at_epoch,
            now_epoch
        ],
        |row| row.get(0),
    )
    .map_err(|e| format!("memories upsert (kind={kind}, source_id={source_id}): {e}"))
}

/// files_mentioned 재계산 — 첫 호출은 `memory_id`의 모든 row를 비우고 새 role을 박는다.
fn replace_files(
    tx: &Transaction,
    memory_id: i64,
    json: &Option<String>,
    role: &str,
) -> Result<(), String> {
    tx.execute(
        "DELETE FROM files_mentioned WHERE memory_id = ?",
        params![memory_id],
    )
    .map_err(|e| format!("files_mentioned delete 실패: {e}"))?;
    for p in parse_files_json(json.as_deref()) {
        insert_file_mention(tx, memory_id, &p, role)?;
    }
    Ok(())
}

/// `replace_files` 이후 같은 `memory_id`에 두 번째 role을 덧붙인다 (DELETE 없이 INSERT만).
fn replace_files_append(
    tx: &Transaction,
    memory_id: i64,
    json: &Option<String>,
    role: &str,
) -> Result<(), String> {
    for p in parse_files_json(json.as_deref()) {
        insert_file_mention(tx, memory_id, &p, role)?;
    }
    Ok(())
}

fn insert_file_mention(
    tx: &Transaction,
    memory_id: i64,
    path: &str,
    role: &str,
) -> Result<(), String> {
    if path.trim().is_empty() {
        return Ok(());
    }
    // PRIMARY KEY (memory_id, file_path, role) — 중복은 OR IGNORE
    tx.execute(
        "INSERT OR IGNORE INTO files_mentioned(memory_id, file_path, role) VALUES(?, ?, ?)",
        params![memory_id, path, role],
    )
    .map(|_| ())
    .map_err(|e| format!("files_mentioned insert 실패: {e}"))
}

/// claude-mem 활성 셋과 mirror 셋의 diff → mirror에서 DELETE.
/// FK ON DELETE CASCADE로 files_mentioned/tags/links_to_vault_notes 자동 정리.
/// FTS5 trigger `memories_ad`로 FTS5 인덱스도 자동 정리.
fn sync_deletions(src: &Connection, tx: &Transaction) -> Result<usize, String> {
    let mut alive: HashSet<(String, i64)> = HashSet::new();

    {
        let mut stmt = src
            .prepare("SELECT id FROM session_summaries WHERE merged_into_project IS NULL")
            .map_err(|e| format!("alive summaries prepare: {e}"))?;
        let mut rows = stmt
            .query([])
            .map_err(|e| format!("alive summaries query: {e}"))?;
        while let Some(r) = rows
            .next()
            .map_err(|e| format!("alive summaries next: {e}"))?
        {
            let id: i64 = r.get(0).map_err(|e| format!("alive summaries get: {e}"))?;
            alive.insert(("summary".to_string(), id));
        }
    }
    {
        let mut stmt = src
            .prepare("SELECT id FROM observations WHERE merged_into_project IS NULL")
            .map_err(|e| format!("alive observations prepare: {e}"))?;
        let mut rows = stmt
            .query([])
            .map_err(|e| format!("alive observations query: {e}"))?;
        while let Some(r) = rows
            .next()
            .map_err(|e| format!("alive observations next: {e}"))?
        {
            let id: i64 = r.get(0).map_err(|e| format!("alive observations get: {e}"))?;
            alive.insert(("observation".to_string(), id));
        }
    }

    let mut to_delete: Vec<(String, i64)> = Vec::new();
    {
        let mut stmt = tx
            .prepare("SELECT kind, source_id FROM memories")
            .map_err(|e| format!("mirror id prepare: {e}"))?;
        let mut rows = stmt.query([]).map_err(|e| format!("mirror id query: {e}"))?;
        while let Some(r) = rows.next().map_err(|e| format!("mirror id next: {e}"))? {
            let kind: String = r.get(0).map_err(|e| format!("kind: {e}"))?;
            let sid: i64 = r.get(1).map_err(|e| format!("sid: {e}"))?;
            if !alive.contains(&(kind.clone(), sid)) {
                to_delete.push((kind, sid));
            }
        }
    }

    let mut deleted = 0usize;
    for (kind, sid) in &to_delete {
        let n = tx
            .execute(
                "DELETE FROM memories WHERE kind = ? AND source_id = ?",
                params![kind, sid],
            )
            .map_err(|e| format!("memories delete 실패: {e}"))?;
        deleted += n;
    }
    Ok(deleted)
}

// ─── 보조 함수 ──────────────────────────────────────────────────────────────

fn read_meta_i64(conn: &Connection, key: &str) -> Result<Option<i64>, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM sync_meta WHERE key = ?",
            params![key],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| format!("sync_meta read({key}): {e}"))?;
    match raw {
        None => Ok(None),
        Some(s) => s
            .parse::<i64>()
            .map(Some)
            .map_err(|e| format!("sync_meta i64 파싱({key}): {e}")),
    }
}

fn write_meta(tx: &Transaction, key: &str, value: &str) -> Result<(), String> {
    tx.execute(
        "INSERT INTO sync_meta(key, value) VALUES(?, ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map(|_| ())
    .map_err(|e| format!("sync_meta write({key}): {e}"))
}

fn now_epoch_s() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// JSON 배열 문자열 → 경로 Vec. invalid면 빈 Vec.
fn parse_files_json(opt: Option<&str>) -> Vec<String> {
    let s = match opt {
        Some(s) if !s.is_empty() => s,
        _ => return Vec::new(),
    };
    serde_json::from_str::<Vec<String>>(s).unwrap_or_default()
}

fn summary_title(request: &Option<String>) -> String {
    request
        .as_deref()
        .and_then(|s| s.lines().find(|l| !l.trim().is_empty()))
        .map(|l| l.trim().to_string())
        .unwrap_or_else(|| "(no title)".to_string())
}

fn build_summary_body(
    request: &Option<String>,
    investigated: &Option<String>,
    learned: &Option<String>,
    completed: &Option<String>,
    next_steps: &Option<String>,
    notes: &Option<String>,
) -> String {
    let parts: [(&str, &Option<String>); 6] = [
        ("Request", request),
        ("Investigated", investigated),
        ("Learned", learned),
        ("Completed", completed),
        ("Next Steps", next_steps),
        ("Notes", notes),
    ];
    join_body_sections(&parts)
}

fn build_observation_body(
    text: &Option<String>,
    subtitle: &Option<String>,
    facts: &Option<String>,
    narrative: &Option<String>,
    concepts: &Option<String>,
) -> String {
    let parts: [(&str, &Option<String>); 5] = [
        ("Subtitle", subtitle),
        ("Text", text),
        ("Narrative", narrative),
        ("Facts", facts),
        ("Concepts", concepts),
    ];
    join_body_sections(&parts)
}

fn join_body_sections(parts: &[(&str, &Option<String>)]) -> String {
    let mut out = String::new();
    for (label, val) in parts {
        if let Some(v) = val.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            if !out.is_empty() {
                out.push_str("\n\n---\n\n");
            }
            out.push_str("## ");
            out.push_str(label);
            out.push_str("\n\n");
            out.push_str(v);
        }
    }
    out
}

/// SHA-256은 외부 crate 의존이라 회피. `DefaultHasher`(SipHash, deterministic seed)로 64bit hex 충분.
/// .md 편집 검출용 — 충돌 가능성 무시 가능.
fn hash_summary(
    request: &Option<String>,
    investigated: &Option<String>,
    learned: &Option<String>,
    completed: &Option<String>,
    next_steps: &Option<String>,
    notes: &Option<String>,
) -> String {
    hash_fields(&[request, investigated, learned, completed, next_steps, notes])
}

fn hash_observation(
    text: &Option<String>,
    subtitle: &Option<String>,
    facts: &Option<String>,
    narrative: &Option<String>,
    concepts: &Option<String>,
) -> String {
    hash_fields(&[text, subtitle, facts, narrative, concepts])
}

/// 필드 경계에 sentinel을 박아 단순 concat collision 회피.
fn hash_fields(fields: &[&Option<String>]) -> String {
    let mut h = DefaultHasher::new();
    for f in fields {
        f.as_deref().unwrap_or("").hash(&mut h);
        "|".hash(&mut h);
    }
    format!("{:016x}", h.finish())
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

/// 풀/증분 sync 1회 실행.
///
/// 5.1.d 학습 적용: sync command가 main IPC handler thread를 점유하면 progress emit이
/// webview에 즉시 도달하지 못함. PR1엔 emit이 없지만 main thread 점유 방지를 위해
/// `spawn_blocking`으로 격리. PR2에서 progress UI 도입 시 그대로 활용 가능.
#[tauri::command]
pub async fn mirror_sync_now(app: AppHandle, full: bool) -> Result<SyncReport, String> {
    tauri::async_runtime::spawn_blocking(move || sync_now(&app, full))
        .await
        .map_err(|e| format!("mirror_sync_now join 실패: {e}"))?
}

/// sync 상태 — 사이드바 indicator (PR2)에서 사용.
#[derive(Debug, Serialize, Clone)]
pub struct SyncStatus {
    pub last_full_sync_at: i64,
    pub last_incremental_sync_at: i64,
    pub last_failure: Option<String>,
    pub memory_count: i64,
}

#[tauri::command]
pub fn mirror_sync_status(app: AppHandle) -> Result<SyncStatus, String> {
    let conn = open_rw(&app)?;
    let last_full = read_meta_i64(&conn, "last_full_sync_at")?.unwrap_or(0);
    let last_inc = read_meta_i64(&conn, "last_incremental_sync_at")?.unwrap_or(0);
    let last_failure: Option<String> = conn
        .query_row(
            "SELECT value FROM sync_meta WHERE key = 'last_failure'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| format!("sync_meta last_failure: {e}"))?;
    let memory_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM memories", [], |r| r.get(0))
        .map_err(|e| format!("memories COUNT: {e}"))?;
    Ok(SyncStatus {
        last_full_sync_at: last_full,
        last_incremental_sync_at: last_inc,
        last_failure,
        memory_count,
    })
}

/// FTS5 hit — `memory::SearchHit`와 호환되는 형태 (UI에서 둘 다 받도록).
#[derive(Debug, Serialize)]
pub struct MirrorSearchHit {
    pub id: i64,
    /// "summary" | "observation"
    #[serde(rename = "type")]
    pub kind: String,
    pub source_id: i64,
    pub project: String,
    pub session_id: String,
    pub created_at: String,
    pub created_at_epoch: i64,
    pub title_hint: String,
    pub snippet_html: String,
    pub score: f64,
    pub channel: String,
    pub obs_type: Option<String>,
}

/// mirror DB FTS5 검색 (`memory_fts_search` 대체 — PR2에서 UI 전환).
#[tauri::command]
pub fn mirror_query_memories(
    app: AppHandle,
    query: String,
    filter: Vec<String>,
    limit: u32,
) -> Result<Vec<MirrorSearchHit>, String> {
    let q = sanitize_fts_query(&query);
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let conn = open_rw(&app)?;

    let (proj_where, proj_params) = build_project_where(&filter);
    let proj_and = if proj_where.is_empty() {
        String::new()
    } else {
        format!(" AND {}", &proj_where[" WHERE ".len()..])
    };

    let sql = format!(
        "SELECT m.id, m.kind, m.source_id, m.project, m.session_id, m.title, m.obs_type, \
                m.created_at, m.created_at_epoch, \
                snippet(memories_fts, -1, '<mark>', '</mark>', '…', 24) AS snip, \
                bm25(memories_fts) AS score \
         FROM memories_fts \
         JOIN memories m ON m.id = memories_fts.rowid \
         WHERE memories_fts MATCH ?{} \
         ORDER BY score \
         LIMIT ?",
        proj_and
    );

    let mut bound: Vec<rusqlite::types::Value> = Vec::with_capacity(proj_params.len() + 2);
    bound.push(q.into());
    for p in &proj_params {
        bound.push(p.clone().into());
    }
    bound.push(rusqlite::types::Value::Integer(limit.clamp(1, 200) as i64));

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("mirror_query_memories prepare: {e}"))?;
    let hits = stmt
        .query_map(rusqlite::params_from_iter(bound.iter()), |r| {
            Ok(MirrorSearchHit {
                id: r.get(0)?,
                kind: r.get(1)?,
                source_id: r.get(2)?,
                project: r.get(3)?,
                session_id: r.get(4)?,
                title_hint: r
                    .get::<_, Option<String>>(5)?
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| "(no title)".to_string()),
                obs_type: r.get(6)?,
                created_at: r.get(7)?,
                created_at_epoch: r.get(8)?,
                snippet_html: r.get(9)?,
                score: r.get(10)?,
                channel: "fts".to_string(),
            })
        })
        .map_err(|e| format!("mirror_query_memories query_map: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("mirror_query_memories collect: {e}"))?;
    Ok(hits)
}

/// files_mentioned 정확 매치 → `memory_related_to_note` 대체 (PR2 UI 전환).
#[derive(Debug, Serialize)]
pub struct MirrorRelatedHit {
    pub id: i64,
    #[serde(rename = "type")]
    pub kind: String,
    pub source_id: i64,
    pub project: String,
    pub title: String,
    pub matched_role: String,
    pub matched_file: String,
    pub obs_type: Option<String>,
    pub created_at: String,
    pub created_at_epoch: i64,
}

#[tauri::command]
pub fn mirror_query_related_to_note(
    app: AppHandle,
    note_abs_path: String,
) -> Result<Vec<MirrorRelatedHit>, String> {
    let conn = open_rw(&app)?;
    let basename = std::path::Path::new(&note_abs_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    let mut stmt = conn
        .prepare(
            "SELECT m.id, m.kind, m.source_id, m.project, m.title, m.obs_type, \
                    fm.role, fm.file_path, m.created_at, m.created_at_epoch \
             FROM files_mentioned fm \
             JOIN memories m ON m.id = fm.memory_id \
             WHERE fm.file_path = ? OR fm.file_path = ? \
             ORDER BY m.created_at_epoch DESC \
             LIMIT 100",
        )
        .map_err(|e| format!("mirror_query_related prepare: {e}"))?;
    let hits = stmt
        .query_map(params![&note_abs_path, &basename], |r| {
            Ok(MirrorRelatedHit {
                id: r.get(0)?,
                kind: r.get(1)?,
                source_id: r.get(2)?,
                project: r.get(3)?,
                title: r
                    .get::<_, Option<String>>(4)?
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| "(no title)".to_string()),
                obs_type: r.get(5)?,
                matched_role: r.get(6)?,
                matched_file: r.get(7)?,
                created_at: r.get(8)?,
                created_at_epoch: r.get(9)?,
            })
        })
        .map_err(|e| format!("mirror_query_related query_map: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("mirror_query_related collect: {e}"))?;
    Ok(hits)
}

// ─── 격리된 FTS5 helper (memory.rs와 동일 정책 복사 — 모듈 자기 완결) ───────

/// FTS5 안전 쿼리. 토큰별 double-quoted phrase로 묵시적 AND.
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

/// project 필터 SQL 빌더. memory.rs와 동일 정책 (worktree 슬래시 prefix까지).
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

// ─── 테스트 ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// in-memory DB에서 schema 빌드 + 멱등성 + FTS5 trigger 동작 확인.
    #[test]
    fn ensure_schema_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        ensure_schema(&conn).expect("첫 빌드");
        ensure_schema(&conn).expect("재호출 시 no-op");

        let v: i32 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v, SCHEMA_VERSION);

        let cnt: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sync_meta WHERE key IN ('last_full_sync_at','last_incremental_sync_at','schema_version')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cnt, 3);

        conn.execute(
            "INSERT INTO memories(kind, source_id, session_id, project, title, body, content_hash, created_at, created_at_epoch, last_synced_at_epoch) \
             VALUES('summary', 1, 's1', 'Lapis', '제목', '본문 텍스트', 'hash1', '2026-05-13', 1, 1)",
            [],
        )
        .unwrap();
        let hit: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM memories_fts WHERE memories_fts MATCH '본문'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hit, 1);
    }

    #[test]
    fn parse_files_json_handles_invalid() {
        assert_eq!(parse_files_json(None), Vec::<String>::new());
        assert_eq!(parse_files_json(Some("")), Vec::<String>::new());
        assert_eq!(parse_files_json(Some("not-json")), Vec::<String>::new());
        assert_eq!(
            parse_files_json(Some(r#"["a.md", "b.md"]"#)),
            vec!["a.md".to_string(), "b.md".to_string()]
        );
    }

    #[test]
    fn summary_title_first_nonempty_line() {
        assert_eq!(summary_title(&None), "(no title)");
        assert_eq!(summary_title(&Some(String::new())), "(no title)");
        assert_eq!(summary_title(&Some("\n\n첫 줄\n둘".to_string())), "첫 줄");
    }

    #[test]
    fn join_body_omits_empty_sections() {
        let body = build_summary_body(
            &Some("요청".to_string()),
            &None,
            &Some("".to_string()),
            &None,
            &Some("다음".to_string()),
            &None,
        );
        assert!(body.contains("## Request\n\n요청"));
        assert!(body.contains("## Next Steps\n\n다음"));
        assert!(!body.contains("## Investigated"));
        assert!(!body.contains("## Learned"));
    }

    #[test]
    fn hash_changes_with_field_boundary() {
        // 단순 concat이면 ("ab", "") == ("a", "b") collision. sentinel로 회피되는지.
        let h1 = hash_fields(&[&Some("ab".to_string()), &Some("".to_string())]);
        let h2 = hash_fields(&[&Some("a".to_string()), &Some("b".to_string())]);
        assert_ne!(h1, h2);
    }
}
