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
use std::collections::{HashMap, HashSet, VecDeque};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

// ─── schema / open ──────────────────────────────────────────────────────────

/// mirror DB의 현재 schema 버전.
/// v1 → v2: `memories_au` 트리거에 `WHEN OLD.content_hash IS NOT NEW.content_hash` 추가
/// + UPSERT의 ON CONFLICT DO UPDATE에 WHERE 절 추가. 풀 sync 비용 대폭 감소 (Phase C.4 발견).
const SCHEMA_VERSION: i32 = 2;

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
///
/// 동시 sync 가능성을 고려해 `busy_timeout`을 설정한다.
/// 시나리오: `openVault` IIFE의 첫 sync(~4s)가 진행 중인 동안 WAL watch가
/// `claude-mem.db-wal` 변경을 감지하면 두 번째 sync 시도가 일어나며 두 RW
/// connection이 같은 lapis-mem.db에 경합 → SQLITE_BUSY. busy_timeout이
/// 있으면 SQLite가 내부적으로 ~ms 단위로 retry해 일시 락은 자연스럽게 풀린다.
pub fn open_rw(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(&path).map_err(|e| format!("mirror DB open 실패: {e}"))?;

    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("PRAGMA journal_mode 실패: {e}"))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("PRAGMA foreign_keys 실패: {e}"))?;
    // 30s — 풀 sync가 trigger 비용 등으로 5s를 넘는 경우(Phase C.4 발견)도 안전망.
    // 진정한 root cause는 ON CONFLICT WHERE + trigger WHEN (schema v2)으로 해소.
    conn.busy_timeout(Duration::from_secs(30))
        .map_err(|e| format!("busy_timeout 설정 실패: {e}"))?;

    ensure_schema(&conn)?;
    Ok(conn)
}

/// `PRAGMA user_version`을 보고 필요 시 schema를 빌드/마이그레이션한다.
fn ensure_schema(conn: &Connection) -> Result<(), String> {
    let current: i32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| format!("PRAGMA user_version 조회 실패: {e}"))?;

    if current == SCHEMA_VERSION {
        return Ok(());
    }
    if current == 0 {
        // 새 DB — v2 형태로 한 번에 빌드 (build_schema_v1 + migrate)
        build_schema_v1(conn)?;
        migrate_v1_to_v2(conn)?;
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(|e| format!("PRAGMA user_version 설정 실패: {e}"))?;
        return Ok(());
    }
    if current == 1 {
        // 비파괴 마이그레이션 — 트리거만 drop + create. 데이터 보존.
        migrate_v1_to_v2(conn)?;
        conn.pragma_update(None, "user_version", 2)
            .map_err(|e| format!("PRAGMA user_version 설정 실패: {e}"))?;
        return Ok(());
    }
    Err(format!(
        "lapis-mem.db schema 버전 불일치: 디스크={current}, 기대={SCHEMA_VERSION}. 재빌드 필요."
    ))
}

/// v1 → v2 마이그레이션 — `memories_au` 트리거에 WHEN 조건 추가.
/// content_hash 변경 없는 UPDATE는 trigger fire skip → 풀 sync 시 FTS5 재인덱스 비용 회피.
fn migrate_v1_to_v2(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        DROP TRIGGER IF EXISTS memories_au;
        CREATE TRIGGER memories_au AFTER UPDATE ON memories
            WHEN OLD.content_hash IS NOT NEW.content_hash
        BEGIN
            INSERT INTO memories_fts(memories_fts, rowid, title, body)
            VALUES('delete', old.id, old.title, old.body);
            INSERT INTO memories_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
        END;
        "#,
    )
    .map_err(|e| format!("v1→v2 트리거 마이그레이션 실패: {e}"))
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
/// 삭제는 항상 셋 diff로 감지. `vault_path`가 주어지면 vault 측 .md도 정리 (#12):
/// - frontmatter `content_hash`가 mirror와 일치 → 자동 삭제
/// - 다르거나 frontmatter에 hash 없음 → `.lapis/orphans.json`에 mark + .md 보존
pub fn sync_now(
    app: &AppHandle,
    full: bool,
    vault_path: Option<String>,
) -> Result<SyncReport, String> {
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

    // 삭제 — DELETE 직전 mirror 측 (kind, source_id, hash) 박제 후 vault .md 정리
    let pending_deletions = collect_deletions(&src, &tx)?;
    let mut orphans = Vec::new();
    if let Some(vp) = vault_path.as_deref() {
        let vault_root = std::path::Path::new(vp);
        if vault_root.exists() {
            for (kind, sid, hash, _mid) in &pending_deletions {
                match cleanup_md_after_delete(vault_root, kind, *sid, hash) {
                    Ok(Some(orphan)) => orphans.push(orphan),
                    Ok(None) => {} // 정상 삭제 또는 .md 부재
                    Err(e) => {
                        eprintln!("[mirror] cleanup_md_after_delete({kind}, {sid}) 실패: {e}");
                    }
                }
            }
            if !orphans.is_empty() {
                if let Err(e) = append_orphans(vault_root, &orphans) {
                    eprintln!("[mirror] orphans.json append 실패: {e}");
                }
            }
        }
    }
    report.deleted = apply_deletions(&tx, &pending_deletions)?;

    // C.4 #2 — vault-aware sync에서 links_to_vault_notes 재계산 (cleanup_md 이후 DELETE도 끝난 상태).
    // WAL watch sync는 vault_path=None이라 skip → 다음 vault-aware sync 시 catch-up.
    if let Some(vp) = vault_path.as_deref() {
        let vault_root = std::path::Path::new(vp);
        if vault_root.exists() {
            match recompute_links_to_vault_notes(&tx, vault_root) {
                Ok(n) => {
                    if n > 0 {
                        eprintln!("[mirror] links_to_vault_notes: {n}건 재계산");
                    }
                }
                Err(e) => {
                    eprintln!("[mirror] links_to_vault_notes 재계산 실패: {e}");
                }
            }
        }
    }

    // sync 성공이면 last_failure 클리어 (#11 status indicator green 복귀)
    tx.execute(
        "DELETE FROM sync_meta WHERE key = 'last_failure'",
        [],
    )
    .map_err(|e| format!("sync_meta last_failure clear: {e}"))?;

    write_meta(&tx, "last_incremental_sync_at", &now_epoch.to_string())?;
    if full {
        write_meta(&tx, "last_full_sync_at", &now_epoch.to_string())?;
    }

    tx.commit()
        .map_err(|e| format!("mirror tx commit 실패: {e}"))?;

    // 데이터 변경 있었으면 검색 LRU 캐시 무효화 — stale 결과 회피.
    if report.summaries_upserted + report.observations_upserted + report.deleted > 0 {
        if let Ok(mut cache) = search_cache().lock() {
            cache.clear();
        }
    }

    // Phase Search #4 — tantivy 인덱스 reindex (이번 sync의 변경 row만).
    // 변경된 row는 last_synced_at_epoch = now_epoch. 삭제된 row의 mirror_id는 pending_deletions에 박제.
    let changed_for_search = match collect_changed_for_search(app, now_epoch) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[search] changed 박제 실패: {e}");
            Vec::new()
        }
    };
    let deleted_mirror_ids: Vec<i64> = pending_deletions
        .iter()
        .map(|(_, _, _, mid)| *mid)
        .collect();
    if !changed_for_search.is_empty() || !deleted_mirror_ids.is_empty() {
        match crate::search::reindex(app, &changed_for_search, &deleted_mirror_ids) {
            Ok(r) => {
                if r.added + r.deleted > 0 {
                    eprintln!(
                        "[search] reindex: +{} -{} · {}ms",
                        r.added, r.deleted, r.duration_ms
                    );
                }
            }
            Err(e) => eprintln!("[search] reindex 실패: {e}"),
        }
    }

    report.duration_ms = start.elapsed().as_millis();
    Ok(report)
}

/// 이번 sync에서 변경된 (kind, source_id) 박제 — tantivy reindex 대상.
/// `last_synced_at_epoch = now_epoch`인 row가 UPSERT WHERE 조건 통과한 변경 row 셋.
fn collect_changed_for_search(
    app: &AppHandle,
    now_epoch: i64,
) -> Result<Vec<(String, i64)>, String> {
    let conn = open_rw(app)?;
    let mut stmt = conn
        .prepare("SELECT kind, source_id FROM memories WHERE last_synced_at_epoch = ?")
        .map_err(|e| format!("changed prepare: {e}"))?;
    let rows = stmt
        .query_map(params![now_epoch], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })
        .map_err(|e| format!("changed query_map: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("changed collect: {e}"))?;
    Ok(rows)
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
    // ON CONFLICT DO UPDATE의 WHERE 절 — content_hash 변경 없으면 UPDATE 자체 skip (NOOP).
    // RETURNING id는 매치된 row만 반환 — 변경 없으면 NoRows. 그 경우 별도 SELECT로 기존 id 회수.
    // 풀 sync 시 11469 row 중 변경 없는 row는 NOOP → trigger fire 0 → 풀 sync 비용 대폭 감소.
    let id_opt: Option<i64> = tx
        .query_row(
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
             WHERE memories.content_hash IS NOT excluded.content_hash \
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
        .optional()
        .map_err(|e| format!("memories upsert (kind={kind}, source_id={source_id}): {e}"))?;

    if let Some(id) = id_opt {
        return Ok(id);
    }
    // 변경 없음 — 기존 id 회수
    tx.query_row(
        "SELECT id FROM memories WHERE kind = ? AND source_id = ?",
        params![kind, source_id],
        |row| row.get(0),
    )
    .map_err(|e| {
        format!("기존 memory_id 조회 실패 (kind={kind}, source_id={source_id}): {e}")
    })
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

/// claude-mem 활성 셋과 mirror 셋의 diff → 삭제 예정 (kind, source_id, mirror_content_hash, mirror_id) 리스트.
/// hash는 `cleanup_md_after_delete`가 vault .md frontmatter와 비교하기 위해 박제.
/// mirror_id는 search 인덱스에서 doc 삭제하기 위해 박제 (DELETE 후엔 알 수 없으므로 사전 박제).
fn collect_deletions(
    src: &Connection,
    tx: &Transaction,
) -> Result<Vec<(String, i64, String, i64)>, String> {
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

    let mut to_delete = Vec::new();
    let mut stmt = tx
        .prepare("SELECT id, kind, source_id, content_hash FROM memories")
        .map_err(|e| format!("mirror id prepare: {e}"))?;
    let mut rows = stmt.query([]).map_err(|e| format!("mirror id query: {e}"))?;
    while let Some(r) = rows.next().map_err(|e| format!("mirror id next: {e}"))? {
        let mirror_id: i64 = r.get(0).map_err(|e| format!("mirror_id: {e}"))?;
        let kind: String = r.get(1).map_err(|e| format!("kind: {e}"))?;
        let sid: i64 = r.get(2).map_err(|e| format!("sid: {e}"))?;
        let hash: String = r.get(3).map_err(|e| format!("hash: {e}"))?;
        if !alive.contains(&(kind.clone(), sid)) {
            to_delete.push((kind, sid, hash, mirror_id));
        }
    }
    Ok(to_delete)
}

/// DELETE 실행 (FK CASCADE + FTS5 trigger로 자동 정리). 반환: 삭제 row 수.
fn apply_deletions(
    tx: &Transaction,
    deletions: &[(String, i64, String, i64)],
) -> Result<usize, String> {
    let mut deleted = 0usize;
    for (kind, sid, _hash, _mid) in deletions {
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

// ─── vault 노트 cross-link 사전 계산 (Phase C.4 #1) ─────────────────────────

/// `links_to_vault_notes`를 vault scan 결과로 재계산.
///
/// 매 vault-aware sync에서 전체 재계산 (DELETE all → INSERT). 매칭 로직은
/// `mirror_query_related_to_note`와 일관 — `file_path == abs_path OR file_path == basename`.
/// `_memories/` 하위는 vault scan에서 제외하여 메모리↔메모리 자기 매치 회피.
///
/// 같은 (memory_id, vault_note_path)에 role 합집합 → 2개 이상이면 'both', 단일이면 그 라벨.
/// 반환: INSERT row 수.
fn recompute_links_to_vault_notes(
    tx: &Transaction,
    vault_root: &std::path::Path,
) -> Result<usize, String> {
    // 1) vault scan — basename(lowercase) → Vec<abs_path>, abs_path 자체도 key로 박제(원본 경로 매치)
    let mut index: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    walk_vault_md(vault_root, &mut index)?;

    // 2) 기존 links 전체 비움
    tx.execute("DELETE FROM links_to_vault_notes", [])
        .map_err(|e| format!("links_to_vault_notes DELETE 실패: {e}"))?;

    // 3) files_mentioned 스캔 + 매칭 + role 합집합
    let mut buf: std::collections::HashMap<(i64, String), HashSet<String>> =
        std::collections::HashMap::new();
    {
        let mut stmt = tx
            .prepare("SELECT memory_id, file_path, role FROM files_mentioned")
            .map_err(|e| format!("files_mentioned scan prepare: {e}"))?;
        let mut rows = stmt
            .query([])
            .map_err(|e| format!("files_mentioned scan query: {e}"))?;
        while let Some(r) = rows
            .next()
            .map_err(|e| format!("files_mentioned scan next: {e}"))?
        {
            let memory_id: i64 = r.get(0).map_err(|e| format!("memory_id: {e}"))?;
            let file_path: String = r.get(1).map_err(|e| format!("file_path: {e}"))?;
            let role: String = r.get(2).map_err(|e| format!("role: {e}"))?;

            // (a) 원본 경로 매치 — claude-mem이 절대 경로로 저장한 경우
            if let Some(candidates) = index.get(&file_path.to_lowercase()) {
                for abs in candidates {
                    buf.entry((memory_id, abs.clone()))
                        .or_default()
                        .insert(role.clone());
                }
            }
            // (b) basename 매치 — claude-mem이 basename만 저장한 경우
            let basename = std::path::Path::new(&file_path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            if !basename.is_empty() && basename != file_path {
                let lowered = basename.to_lowercase();
                if let Some(candidates) = index.get(&lowered) {
                    for abs in candidates {
                        buf.entry((memory_id, abs.clone()))
                            .or_default()
                            .insert(role.clone());
                    }
                }
            }
        }
    }

    // 4) 합집합 → INSERT
    let mut inserted = 0usize;
    for ((memory_id, vault_note_path), roles) in buf {
        let match_role = if roles.len() > 1 {
            "both".to_string()
        } else {
            roles
                .into_iter()
                .next()
                .unwrap_or_else(|| "read".to_string())
        };
        let n = tx
            .execute(
                "INSERT OR IGNORE INTO links_to_vault_notes(memory_id, vault_note_path, match_role) VALUES(?,?,?)",
                params![memory_id, vault_note_path, match_role],
            )
            .map_err(|e| format!("links_to_vault_notes INSERT 실패: {e}"))?;
        inserted += n;
    }
    Ok(inserted)
}

/// vault 재귀 walk — `.md` 파일만 수집. `_memories/` + 흔한 무관 디렉토리는 skip.
/// 결과는 lowercase(abs) + lowercase(basename) 두 키로 박제 (절대 경로 / basename 매치 양쪽 지원).
fn walk_vault_md(
    dir: &std::path::Path,
    index: &mut std::collections::HashMap<String, Vec<String>>,
) -> Result<(), String> {
    const SKIP_DIRS: &[&str] = &[
        "_memories",
        ".git",
        "node_modules",
        ".obsidian",
        ".lapis",
        "target",
        "dist",
        "build",
        ".svelte-kit",
    ];

    let rd =
        std::fs::read_dir(dir).map_err(|e| format!("vault read_dir {}: {e}", dir.display()))?;
    for entry in rd.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(n) => n,
            None => continue,
        };

        if path.is_dir() {
            if name.starts_with('.') && name != "." {
                continue;
            }
            if SKIP_DIRS.contains(&name) {
                continue;
            }
            walk_vault_md(&path, index)?;
            continue;
        }

        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let abs = path.to_string_lossy().to_string();
        index
            .entry(abs.to_lowercase())
            .or_default()
            .push(abs.clone());
        let lowered_name = name.to_lowercase();
        if lowered_name != abs.to_lowercase() {
            index.entry(lowered_name).or_default().push(abs.clone());
        }
    }
    Ok(())
}

// ─── .md 자동 삭제 + orphan 박제 (PR2 #12) ─────────────────────────────────

/// vault `_memories/`에서 (kind, source_id) → .md 찾고 mirror hash와 비교 후 정리.
///
/// 반환:
/// - `Ok(None)`: 정상 삭제 또는 .md 부재 (정리 불필요)
/// - `Ok(Some(OrphanRecord))`: 사용자 편집 흔적/legacy hash 없음 → .md 보존 + orphans.json 기록 대상
fn cleanup_md_after_delete(
    vault_root: &std::path::Path,
    kind: &str,
    source_id: i64,
    mirror_hash: &str,
) -> Result<Option<OrphanRecord>, String> {
    let md_path_opt = match kind {
        "summary" => crate::memory::find_summary_md_by_mem_id(vault_root, source_id)?,
        "observation" => crate::memory::find_observation_md_by_mem_id(vault_root, source_id)?,
        _ => return Ok(None),
    };
    let Some(md_path) = md_path_opt else {
        return Ok(None);
    };
    let md_path_buf = PathBuf::from(&md_path);

    let file_hash = crate::memory::peek_content_hash(&md_path_buf);
    let now = now_epoch_s();
    match file_hash {
        Some(h) if h == mirror_hash => {
            // 사용자 편집 흔적 없음 → 안전 삭제
            std::fs::remove_file(&md_path_buf)
                .map_err(|e| format!("remove_file {}: {e}", md_path_buf.display()))?;
            Ok(None)
        }
        Some(_) => Ok(Some(OrphanRecord {
            path: md_path,
            kind: kind.to_string(),
            source_id,
            reason: "user-edited".to_string(),
            detected_at_epoch: now,
        })),
        None => Ok(Some(OrphanRecord {
            path: md_path,
            kind: kind.to_string(),
            source_id,
            reason: "legacy-no-hash".to_string(),
            detected_at_epoch: now,
        })),
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct OrphanRecord {
    pub path: String,
    pub kind: String,
    pub source_id: i64,
    pub reason: String,
    pub detected_at_epoch: i64,
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct OrphansFile {
    orphans: Vec<OrphanRecord>,
}

/// `.lapis/orphans.json` append (atomic write — 5.1.d 학습 적용).
/// 같은 (kind, source_id)가 이미 있으면 최신 record로 교체.
fn append_orphans(
    vault_root: &std::path::Path,
    new_records: &[OrphanRecord],
) -> Result<(), String> {
    if new_records.is_empty() {
        return Ok(());
    }
    let lapis_dir = vault_root.join(".lapis");
    std::fs::create_dir_all(&lapis_dir).map_err(|e| format!(".lapis dir 생성: {e}"))?;
    let path = lapis_dir.join("orphans.json");

    // 기존 read (없거나 파싱 실패면 빈 array로 시작)
    let mut existing: Vec<OrphanRecord> = if path.exists() {
        std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<OrphansFile>(&raw).ok())
            .map(|f| f.orphans)
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    // dedup: 같은 (kind, source_id) 키면 새 record로 교체
    for r in new_records {
        existing.retain(|e| !(e.kind == r.kind && e.source_id == r.source_id));
        existing.push(r.clone());
    }

    let serialized = serde_json::to_string_pretty(&OrphansFile { orphans: existing })
        .map_err(|e| format!("orphans serialize: {e}"))?;

    // atomic write — 같은 디렉토리에 temp 후 rename
    let tmp = lapis_dir.join(format!(
        ".orphans.json.tmp.lapis-{}-{}",
        std::process::id(),
        now_epoch_s()
    ));
    std::fs::write(&tmp, serialized)
        .map_err(|e| format!("orphans tmp write({}): {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path)
        .map_err(|e| format!("orphans rename {} → {}: {e}", tmp.display(), path.display()))?;
    Ok(())
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
/// .md 편집 검출용 — 충돌 가능성 무시 가능. pub로 노출되어 memory.rs export 흐름이 동일 hash를 박제.
pub fn hash_summary(
    request: &Option<String>,
    investigated: &Option<String>,
    learned: &Option<String>,
    completed: &Option<String>,
    next_steps: &Option<String>,
    notes: &Option<String>,
) -> String {
    hash_fields(&[request, investigated, learned, completed, next_steps, notes])
}

pub fn hash_observation(
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

// ─── WAL watch (PR2 단위 #9) ────────────────────────────────────────────────

/// WAL 이벤트 burst를 모으는 디바운스 (ms).
/// SQLite WAL은 write마다 mtime이 갱신되므로 1s 내 다발 write는 한 번에 묶음.
const WAL_DEBOUNCE_MS: u64 = 1000;

/// 백그라운드에서 `~/.claude-mem/`을 watch하고 `claude-mem.db*` 파일 변경 시 증분 sync.
///
/// 설계:
/// - `~/.claude-mem/` 디렉토리 watch (NonRecursive). `claude-mem.db-wal`이 checkpoint로
///   삭제됐다 재생성되어도 같은 watcher가 유지되도록 디렉토리 단위.
/// - 디렉토리 안 다른 파일(logs 등)은 filename prefix로 무시.
/// - `Box::leak`으로 watcher를 앱 lifetime에 묶음 — vault watcher와 달리 unwatch 불필요.
pub fn start_wal_watch(app: AppHandle) -> Result<(), String> {
    use notify::{RecommendedWatcher, RecursiveMode, Watcher};

    let dir = claude_mem_db_path()?
        .parent()
        .ok_or_else(|| "claude-mem.db 부모 디렉토리 조회 실패".to_string())?
        .to_path_buf();
    if !dir.exists() {
        return Err(format!("claude-mem 디렉토리 없음: {}", dir.display()));
    }

    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher: RecommendedWatcher = notify::recommended_watcher(tx)
        .map_err(|e| format!("WAL watch 생성 실패: {e}"))?;
    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("WAL watch 등록 실패: {e}"))?;

    let app_for_loop = app.clone();
    std::thread::spawn(move || wal_debounce_loop(rx, app_for_loop));

    // 앱 lifetime 동안 watcher 유지. Drop되면 watch 끊김.
    Box::leak(Box::new(watcher));
    Ok(())
}

fn wal_debounce_loop(
    rx: std::sync::mpsc::Receiver<notify::Result<notify::Event>>,
    app: AppHandle,
) {
    let mut last_event_at: Option<Instant> = None;

    loop {
        let timeout = match last_event_at {
            None => Duration::from_secs(60 * 60),
            Some(t) => {
                let elapsed = t.elapsed();
                Duration::from_millis(WAL_DEBOUNCE_MS).saturating_sub(elapsed)
            }
        };

        match rx.recv_timeout(timeout) {
            Ok(Ok(event)) => {
                if event_matches_claude_mem(&event) {
                    last_event_at = Some(Instant::now());
                }
            }
            Ok(Err(_)) => {
                // notify 내부 에러는 무시 — 다음 이벤트로 회복 시도
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if last_event_at.take().is_some() {
                    // debounce 윈도우 종료 — sync 실행.
                    // WAL watch에선 vault_path를 모름. .md 정리는 vault가 열려 있을 때만
                    // (사용자 수동 mirror sync / openVault IIFE)에서 수행.
                    match sync_now(&app, false, None) {
                        Ok(report) => {
                            let _ = app.emit("mirror-sync-done", &report);
                        }
                        Err(e) => {
                            // sync_meta에 last_failure 박제 — status indicator(#11)에서 surface
                            if let Ok(conn) = open_rw(&app) {
                                let _ = conn.execute(
                                    "INSERT INTO sync_meta(key, value) VALUES('last_failure', ?) \
                                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                                    params![&e],
                                );
                            }
                            let _ = app.emit("mirror-sync-error", &e);
                        }
                    }
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

/// 이벤트 경로 중 하나라도 `claude-mem.db*`이면 관심.
/// `claude-mem.db` / `claude-mem.db-wal` / `claude-mem.db-shm` 모두 catch.
fn event_matches_claude_mem(event: &notify::Event) -> bool {
    event.paths.iter().any(|p| {
        p.file_name()
            .and_then(|s| s.to_str())
            .is_some_and(|name| name.starts_with("claude-mem.db"))
    })
}

// ─── 검색 LRU 캐시 (검색 응답성 chore) ───────────────────────────────────────

/// 검색 결과 LRU 캐시 키 — query + filter + limit + 두 토글.
type SearchCacheKey = (String, Vec<String>, u32, bool, bool);

/// 단순 LRU 캐시 — 외부 crate 없이. cap을 넘으면 가장 오래 미접근 entry 제거.
struct SearchLru {
    map: HashMap<SearchCacheKey, Vec<MirrorSearchHit>>,
    order: VecDeque<SearchCacheKey>,
    cap: usize,
}

impl SearchLru {
    fn new(cap: usize) -> Self {
        Self {
            map: HashMap::new(),
            order: VecDeque::new(),
            cap,
        }
    }

    fn get(&mut self, key: &SearchCacheKey) -> Option<Vec<MirrorSearchHit>> {
        if !self.map.contains_key(key) {
            return None;
        }
        // MRU 갱신 — 제거 후 끝에 다시 push.
        self.order.retain(|k| k != key);
        self.order.push_back(key.clone());
        self.map.get(key).cloned()
    }

    fn put(&mut self, key: SearchCacheKey, value: Vec<MirrorSearchHit>) {
        if self.map.contains_key(&key) {
            self.order.retain(|k| k != &key);
        } else if self.map.len() >= self.cap {
            if let Some(oldest) = self.order.pop_front() {
                self.map.remove(&oldest);
            }
        }
        self.order.push_back(key.clone());
        self.map.insert(key, value);
    }

    fn clear(&mut self) {
        self.map.clear();
        self.order.clear();
    }
}

static SEARCH_CACHE: OnceLock<Mutex<SearchLru>> = OnceLock::new();

fn search_cache() -> &'static Mutex<SearchLru> {
    SEARCH_CACHE.get_or_init(|| Mutex::new(SearchLru::new(50)))
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

/// 풀/증분 sync 1회 실행.
///
/// 5.1.d 학습 적용: sync command가 main IPC handler thread를 점유하면 progress emit이
/// webview에 즉시 도달하지 못함. PR1엔 emit이 없지만 main thread 점유 방지를 위해
/// `spawn_blocking`으로 격리. PR2에서 progress UI 도입 시 그대로 활용 가능.
///
/// `vault_path`가 주어지면 sync 안에서 .md 자동 정리(편집 보존 + orphans.json)도 함께.
#[tauri::command]
pub async fn mirror_sync_now(
    app: AppHandle,
    full: bool,
    vault_path: Option<String>,
) -> Result<SyncReport, String> {
    tauri::async_runtime::spawn_blocking(move || sync_now(&app, full, vault_path))
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
#[derive(Debug, Serialize, Clone)]
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
///
/// `include_summaries`/`include_observations`는 kind 필터.
/// 둘 다 false면 빈 결과 반환 (UI 측에서 type 필터 OFF 시 호출 회피용 short-circuit).
///
/// 5.1.d 학습 적용: 매치 doc이 많을 때 bm25 채점 비용으로 수 초까지 걸리는 케이스가
/// 있어 `spawn_blocking`으로 worker thread에 격리. main IPC handler thread를 막지 않아
/// 검색 중에도 다른 UI는 응답성 유지.
#[tauri::command]
pub async fn mirror_query_memories(
    app: AppHandle,
    query: String,
    filter: Vec<String>,
    limit: u32,
    include_summaries: bool,
    include_observations: bool,
) -> Result<Vec<MirrorSearchHit>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        mirror_query_memories_inner(&app, query, filter, limit, include_summaries, include_observations)
    })
    .await
    .map_err(|e| format!("mirror_query_memories join 실패: {e}"))?
}

fn mirror_query_memories_inner(
    app: &AppHandle,
    query: String,
    filter: Vec<String>,
    limit: u32,
    include_summaries: bool,
    include_observations: bool,
) -> Result<Vec<MirrorSearchHit>, String> {
    // LRU cache hit 확인 — 같은 query 반복 시 즉시 반환 (sync 후 자동 무효화).
    let cache_key: SearchCacheKey = (
        query.clone(),
        filter.clone(),
        limit,
        include_summaries,
        include_observations,
    );
    if let Ok(mut cache) = search_cache().lock() {
        if let Some(cached) = cache.get(&cache_key) {
            return Ok(cached);
        }
    }

    let q = sanitize_fts_query(&query);
    if q.is_empty() {
        return Ok(Vec::new());
    }

    // kind 필터 — hardcoded literal이라 SQL injection 무관.
    let mut kind_literals: Vec<&'static str> = Vec::new();
    if include_summaries {
        kind_literals.push("'summary'");
    }
    if include_observations {
        kind_literals.push("'observation'");
    }
    if kind_literals.is_empty() {
        return Ok(Vec::new());
    }
    let kind_and = format!(" AND m.kind IN ({})", kind_literals.join(","));

    let conn = open_rw(app)?;

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
         WHERE memories_fts MATCH ?{}{} \
         ORDER BY score \
         LIMIT ?",
        kind_and, proj_and
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

    // LRU cache 박제 — 다음 호출 즉시 반환. sync 시 자동 invalidate.
    if let Ok(mut cache) = search_cache().lock() {
        cache.put(cache_key, hits.clone());
    }
    Ok(hits)
}

/// files_mentioned 정확 매치 → `memory_related_to_note` 대체 (PR2 UI 전환).
///
/// 한 메모리가 같은 노트를 `read` + `modified` 등 여러 role로 갖고 있어도 row 1건으로 GROUP BY.
/// `matched_roles`는 합집합 (예: `["read", "modified"]`).
#[derive(Debug, Serialize)]
pub struct MirrorRelatedHit {
    pub id: i64,
    #[serde(rename = "type")]
    pub kind: String,
    pub source_id: i64,
    pub project: String,
    pub title: String,
    /// 해당 메모리가 이 노트를 다룬 role 합집합. "read" | "edited" | "modified" 중 1개 이상.
    pub matched_roles: Vec<String>,
    /// 매치된 file_path 대표 1개 (절대 경로 또는 basename).
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

    // GROUP BY m.id — 같은 메모리가 read+modified 두 role로 갖고 있어도 row 1건.
    // GROUP_CONCAT은 DISTINCT 지원, separator는 기본 ','.
    let mut stmt = conn
        .prepare(
            "SELECT m.id, m.kind, m.source_id, m.project, m.title, m.obs_type, \
                    GROUP_CONCAT(DISTINCT fm.role) AS roles, \
                    MIN(fm.file_path) AS matched_file, \
                    m.created_at, m.created_at_epoch \
             FROM files_mentioned fm \
             JOIN memories m ON m.id = fm.memory_id \
             WHERE fm.file_path = ? OR fm.file_path = ? \
             GROUP BY m.id \
             ORDER BY m.created_at_epoch DESC \
             LIMIT 100",
        )
        .map_err(|e| format!("mirror_query_related prepare: {e}"))?;
    let hits = stmt
        .query_map(params![&note_abs_path, &basename], |r| {
            let roles_csv: String = r.get(6)?;
            let matched_roles: Vec<String> = roles_csv
                .split(',')
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect();
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
                matched_roles,
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

// ─── memory ↔ vault note links (Phase C.4 #3) ──────────────────────────────

/// 그래프 노드 + 엣지 생성용. `links_to_vault_notes`를 memory 메타와 JOIN해 반환.
#[derive(Debug, Serialize)]
pub struct MemoryLink {
    pub memory_id: i64,
    #[serde(rename = "type")]
    pub kind: String,
    pub source_id: i64,
    pub title: String,
    pub project: String,
    pub vault_note_path: String,
    /// "read" | "edited" | "modified" | "both"
    pub match_role: String,
    pub obs_type: Option<String>,
}

/// 모든 memory ↔ vault note 링크 반환 (그래프 모달이 일괄 로드).
/// 11469 memory × 평균 ~1 vault note 매칭 → 수천 row 예상. JSON 직렬화 비용은 있지만 매 그래프 open마다 1회.
#[tauri::command]
pub fn mirror_list_memory_links(app: AppHandle) -> Result<Vec<MemoryLink>, String> {
    let conn = open_rw(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT l.memory_id, m.kind, m.source_id, m.title, m.project, l.vault_note_path, \
                    l.match_role, m.obs_type \
             FROM links_to_vault_notes l \
             JOIN memories m ON m.id = l.memory_id",
        )
        .map_err(|e| format!("mirror_list_memory_links prepare: {e}"))?;
    let hits = stmt
        .query_map([], |r| {
            Ok(MemoryLink {
                memory_id: r.get(0)?,
                kind: r.get(1)?,
                source_id: r.get(2)?,
                title: r
                    .get::<_, Option<String>>(3)?
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| "(no title)".to_string()),
                project: r.get(4)?,
                vault_note_path: r.get(5)?,
                match_role: r.get(6)?,
                obs_type: r.get(7)?,
            })
        })
        .map_err(|e| format!("mirror_list_memory_links query_map: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("mirror_list_memory_links collect: {e}"))?;
    Ok(hits)
}

// ─── 격리된 FTS5 helper (memory.rs와 동일 정책 복사 — 모듈 자기 완결) ───────

/// FTS5 안전 쿼리. 모든 토큰을 prefix 매치(`token*`)로.
///
/// 일반 검색 UX 일관성: "atomic" 입력 시 "atomicity"도 매치 (prefix). cutoff 도입은
/// "atomic" → "atomicity" 미매치를 만들어 UX 위반이라 채택 안 함. 매치 doc 수가 많은
/// 케이스의 응답성은 spawn_blocking + LRU cache + debounce로 보완.
///
/// `atomic-purring`은 `unicode61` 토크나이저로 `["atomic", "purring"]` 분리됨.
/// `atomic pur` 쿼리 → `atomic* AND pur*` → 정확히 매치.
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
                format!("{}*", cleaned)
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
