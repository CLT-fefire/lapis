//! Phase 6.0 — claude-mem ON→OFF 전환 시 로컬 부산물 정리.
//!
//! 정리 대상:
//! - `{app_data_dir}/lapis-mem.db` (+ `-wal`, `-shm`)
//! - `{app_data_dir}/search-index/` 전체
//!
//! **보존**: vault 안 `_memories/**` (사용자 데이터), `~/.claude-mem/*` (claude-mem 원본).
//!
//! frontend는 `cleanup-progress`, `cleanup-error` 이벤트를 listen해서 overlay 표시.

use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager};

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

/// pending_cleanup이 true면 한 번 실행. 성공 시 flag clear.
/// 실패해도 flag는 그대로 둠 → 다음 시작에서 재시도.
/// 시동 흐름의 다른 부팅을 막지 않도록 spawn된 worker에서 호출 권장.
pub fn run_pending_cleanup(app: &AppHandle) {
    emit(app, "starting", "정리를 시작합니다…");

    let app_data_dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(e) => {
            emit_error(app, format!("app_data_dir 조회 실패: {e}"));
            return;
        }
    };

    // 1) mirror DB + WAL/SHM 삭제
    emit(app, "mirror", "mirror DB 삭제…");
    let mirror_files = ["lapis-mem.db", "lapis-mem.db-wal", "lapis-mem.db-shm"];
    for f in &mirror_files {
        let p = app_data_dir.join(f);
        if let Err(e) = remove_file_if_exists(&p) {
            emit_error(app, format!("{} 삭제 실패: {e}", p.display()));
            return;
        }
    }

    // 2) search-index 디렉토리 삭제
    emit(app, "search-index", "검색 인덱스 삭제…");
    let idx_dir = app_data_dir.join("search-index");
    if let Err(e) = remove_dir_if_exists(&idx_dir) {
        emit_error(app, format!("{} 삭제 실패: {e}", idx_dir.display()));
        return;
    }

    // 3) flag clear
    if let Err(e) = crate::settings::clear_pending_cleanup(app) {
        emit_error(app, format!("flag clear 실패: {e}"));
        return;
    }

    emit(app, "done", "정리 완료.");
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
