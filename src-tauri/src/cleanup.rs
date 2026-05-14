//! Phase 6.0 — claude-mem ON→OFF 전환 시 로컬 부산물 정리.
//!
//! 정리 대상:
//! - `{app_data_dir}/lapis-mem.db` (+ `-wal`, `-shm`)
//! - `{app_data_dir}/search-index/` 전체
//!
//! **보존**: vault 안 `_memories/**` (사용자 데이터), `~/.claude-mem/*` (claude-mem 원본).
//!
//! frontend는 `cleanup-progress`, `cleanup-error` 이벤트를 listen해서 overlay 표시.
//!
//! 진입점은 두 개:
//! - `run_cleanup`: 동적 토글 OFF 시 즉시 호출 (pending_cleanup flag 무관)
//! - `run_pending_cleanup`: legacy backward-compat — 시동 시 flag가 켜져 있으면 한 번 처리

use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// in-flight sync_now가 끝날 때까지 최대 `timeout`만큼 대기.
/// 정상 sync는 1.7~5s, 첫 대량 sync도 ~15s 안쪽이라 30s timeout 안전 마진.
fn wait_for_sync_to_finish(timeout: Duration) -> bool {
    let started = Instant::now();
    while crate::mirror::is_sync_in_flight() {
        if started.elapsed() > timeout {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    true
}

#[derive(Debug, Clone, Serialize)]
pub struct CleanupProgress {
    pub stage: &'static str,
    pub message: String,
}

fn emit(app: &AppHandle, stage: &'static str, message: impl Into<String>) {
    let _ = app.emit(
        "cleanup-progress",
        CleanupProgress {
            stage,
            message: message.into(),
        },
    );
}

fn emit_error(app: &AppHandle, message: impl Into<String>) {
    let _ = app.emit("cleanup-error", message.into());
}

/// 동적 OFF 토글 시 즉시 호출. mirror DB + search-index 삭제 후 done emit.
/// pending_cleanup flag와 무관 — 호출자가 흐름을 주도한다.
pub fn run_cleanup(app: &AppHandle) {
    eprintln!("[diag][cleanup] 시작");
    emit(app, "starting", "정리를 시작합니다…");

    // sync_now가 진행 중이면 끝날 때까지 대기 — sync 도중 mirror DB / search-index 파일 unlink는
    // SQLite와 tantivy 양쪽에 ghost FD를 남겨 결국 데이터 손실 + reindex 실패 유발.
    if crate::mirror::is_sync_in_flight() {
        eprintln!("[diag][cleanup] in-flight sync 감지 — 완료까지 최대 30s 대기");
        emit(app, "starting", "진행 중인 sync 완료를 기다리는 중…");
        let finished = wait_for_sync_to_finish(Duration::from_secs(30));
        if !finished {
            eprintln!("[diag][cleanup] sync 대기 timeout (30s) — 정리 강행");
        } else {
            eprintln!("[diag][cleanup] sync 완료 확인 — 정리 진행");
        }
    }

    let app_data_dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[diag][cleanup] app_data_dir 실패: {e}");
            emit_error(app, format!("app_data_dir 조회 실패: {e}"));
            return;
        }
    };

    emit(app, "mirror", "mirror DB 삭제…");
    let mirror_files = ["lapis-mem.db", "lapis-mem.db-wal", "lapis-mem.db-shm"];
    for f in &mirror_files {
        let p = app_data_dir.join(f);
        let existed = p.exists();
        if let Err(e) = remove_file_if_exists(&p) {
            eprintln!("[diag][cleanup] {} 삭제 실패: {e}", p.display());
            emit_error(app, format!("{} 삭제 실패: {e}", p.display()));
            return;
        }
        if existed {
            eprintln!("[diag][cleanup] 삭제 OK · {}", p.display());
        }
    }

    emit(app, "search-index", "검색 인덱스 삭제…");
    let idx_dir = app_data_dir.join("search-index");
    let idx_existed = idx_dir.exists();
    if let Err(e) = remove_dir_if_exists(&idx_dir) {
        eprintln!("[diag][cleanup] search-index 삭제 실패: {e}");
        emit_error(app, format!("{} 삭제 실패: {e}", idx_dir.display()));
        return;
    }
    if idx_existed {
        eprintln!("[diag][cleanup] 삭제 OK · {}", idx_dir.display());
    }

    eprintln!("[diag][cleanup] 완료");
    emit(app, "done", "정리 완료.");
}

/// 시동 시점 backward-compat 진입점 — legacy `pending_cleanup` flag가 켜져 있으면 정리 후 flag clear.
/// 새 동적 토글 흐름에선 flag가 안 켜지지만, 이전 버전에서 마이그레이션 중인 설치엔 필요.
pub fn run_pending_cleanup(app: &AppHandle) {
    run_cleanup(app);
    if let Err(e) = crate::settings::clear_pending_cleanup(app) {
        emit_error(app, format!("flag clear 실패: {e}"));
    }
}

fn remove_file_if_exists(p: &Path) -> std::io::Result<()> {
    match fs::remove_file(p) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

fn remove_dir_if_exists(p: &Path) -> std::io::Result<()> {
    match fs::remove_dir_all(p) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}
