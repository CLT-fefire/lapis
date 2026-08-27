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

    /// 사용자 정의 CSS. 앱이 `<style data-lapis="user-css">`로 head 끝에 넣는다.
    ///
    /// ⚠️ **여기 있는 이유가 안전장치다.** 사용자가 `[data-lapis="app"] { display: none }`
    /// 한 줄을 쓰면 앱이 안 보이고 설정에도 못 들어간다. 그때 되돌리는 길이 셋인데
    /// 둘이 이 파일에 의존한다 — `lapis css --off`가 이 JSON을 직접 고치고, 최후에는
    /// 파일을 지우면 초기화된다. localStorage에 뒀으면 앱 밖에서 손댈 방법이 없다.
    #[serde(default)]
    pub custom_css: String,

    /// 사용자 정의 CSS 적용 여부. **기본 true** — 비어 있으면 어차피 아무 일도 없다.
    ///
    /// 화면이 새까매졌을 때 패닉 단축키가 이 값을 끈다. 키 핸들러는 CSS와 무관하게
    /// 돌기 때문에 **화면이 안 보여도 듣는다.** 그게 1차 방어선이다.
    #[serde(default = "default_true")]
    pub custom_css_enabled: bool,

    /// 색 테마 프리셋 id (`colorThemes.ts`의 `COLOR_THEMES`). 빈 값이면 기본.
    ///
    /// ⚠️ 값을 여기서 검증하지 않는다 — 목록이 프런트에 있고, 모르는 id는 프런트가
    /// 기본으로 떨어뜨린다. Rust가 목록을 복제하면 둘이 갈린다.
    #[serde(default)]
    pub color_theme: String,
}

fn default_true() -> bool {
    true
}

fn default_backup_keep() -> u32 {
    20
}

impl Default for LapisSettings {
    fn default() -> Self {
        Self {
            link_rewrite_backup_keep: default_backup_keep(),
            mcp_enabled: false,
            custom_css: String::new(),
            custom_css_enabled: true,
            color_theme: String::new(),
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
