//! Lapis 앱 전역 설정 (`lapis-settings.json`).
//!
//! 백엔드 JSON이 단일 SOT. frontend는 시동 시 `settings_read`로 한 번 읽고 store에 반영.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

const SETTINGS_FILENAME: &str = "lapis-settings.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LapisSettings {
    /// 노트 이름 변경 시 `.lapis/link-rewrite-backup/<ts>/` 스냅샷의 최대 보존 개수.
    /// 초과 시 오래된 것부터 prune. 1-100 사이로 clamp (settings_write 단계).
    #[serde(default = "default_backup_keep")]
    pub link_rewrite_backup_keep: u32,

    /// MCP(`lapis_query`)의 질의 허용 여부. **기본 false** — 명시적으로 켜야 동작한다.
    ///
    /// ⚠️ 이 값은 서버 **프로세스 기동**과 무관하다. `lapis-mcp`는 stdio 서버라
    /// MCP 클라이언트(Claude Code/Desktop)가 자식 프로세스로 띄운다. 앱이 정할 수 있는
    /// 건 "질의를 받아줄지"뿐이고, 기동까지 막으려면 클라이언트 등록에서 빼야 한다.
    ///
    /// ⚠️ `#[serde(default)]`라 **필드가 없는 기존 JSON도 false로 읽힌다.** 의도된
    /// 동작이지만(기본 OFF), 업그레이드 직후 쓰던 `lapis_query`가 멈춘다.
    #[serde(default)]
    pub mcp_enabled: bool,
}

fn default_backup_keep() -> u32 {
    20
}

impl Default for LapisSettings {
    fn default() -> Self {
        Self {
            link_rewrite_backup_keep: default_backup_keep(),
            mcp_enabled: false,
        }
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    // dev/릴리즈 분기는 `paths`가 단일 진실 — 여기서 `app_data_dir()`을 직접 부르면
    // dev 빌드가 릴리즈 설정을 덮어쓴다.
    Ok(crate::paths::app_data_root(app)?.join(SETTINGS_FILENAME))
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

// ─── Tauri commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn settings_read(app: AppHandle) -> Result<LapisSettings, String> {
    Ok(load(&app))
}

#[tauri::command]
pub fn settings_write(app: AppHandle, next: LapisSettings) -> Result<(), String> {
    save(&app, &next)
}
