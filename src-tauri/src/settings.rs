//! Lapis 앱 전역 설정 (`lapis-settings.json`).
//!
//! Phase 6.0 — claude-mem 통합 옵션화. frontend localStorage가 source of truth지만
//! Rust startup이 WAL watcher / search index 부팅 분기를 결정하려면 frontend 부팅 전에
//! 옵션을 알아야 한다 → 별도 JSON 파일을 disk에 둔다. frontend가 토글 시 settings_write
//! command로 둘 다 동시에 갱신.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const SETTINGS_FILENAME: &str = "lapis-settings.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LapisSettings {
    /// claude-mem 관련 UI/백엔드 동작 활성 여부. 기본 false (팀원 배포 기본값).
    #[serde(default)]
    pub claude_mem_enabled: bool,
    /// 다음 startup 시 ON→OFF 전환 정리 routine을 실행해야 함을 표시.
    #[serde(default)]
    pub pending_cleanup: bool,
}

impl Default for LapisSettings {
    fn default() -> Self {
        Self {
            claude_mem_enabled: false,
            pending_cleanup: false,
        }
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir 조회 실패: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("app_data_dir 생성 실패: {e}"))?;
    Ok(dir.join(SETTINGS_FILENAME))
}

/// 파일에서 설정 읽기. 없거나 파싱 실패면 기본값. 시동 초입에서도 호출 가능 (app handle만 필요).
pub fn load(app: &AppHandle) -> LapisSettings {
    let path = match settings_path(app) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[settings] path 조회 실패 → 기본값: {e}");
            return LapisSettings::default();
        }
    };
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return LapisSettings::default(),
    };
    match serde_json::from_str::<LapisSettings>(&raw) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[settings] {} 파싱 실패 → 기본값: {e}", path.display());
            LapisSettings::default()
        }
    }
}

/// 파일에 설정 쓰기. atomic write (temp → rename).
pub fn save(app: &AppHandle, next: &LapisSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let json =
        serde_json::to_string_pretty(next).map_err(|e| format!("settings 직렬화 실패: {e}"))?;
    let parent = path
        .parent()
        .ok_or_else(|| "settings parent dir 없음".to_string())?;
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp = parent.join(format!(".lapis-settings.tmp.{}-{}", pid, nanos));
    fs::write(&temp, json.as_bytes()).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("settings temp write 실패: {e}")
    })?;
    fs::rename(&temp, &path).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("settings rename 실패: {e}")
    })?;
    Ok(())
}

/// 시동 시점에 `pending_cleanup` flag만 끄고 저장. 정리 routine 성공 후 호출.
pub fn clear_pending_cleanup(app: &AppHandle) -> Result<(), String> {
    let mut cur = load(app);
    if !cur.pending_cleanup {
        return Ok(());
    }
    cur.pending_cleanup = false;
    save(app, &cur)
}

// ─── Tauri commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn settings_read(app: AppHandle) -> Result<LapisSettings, String> {
    Ok(load(&app))
}

#[tauri::command]
pub fn settings_write(app: AppHandle, next: LapisSettings) -> Result<(), String> {
    save(&app, &next)
}

#[tauri::command]
pub fn app_restart(app: AppHandle) {
    app.restart();
}
