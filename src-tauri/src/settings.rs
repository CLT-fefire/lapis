//! Lapis 앱 전역 설정 (`lapis-settings.json`).
//!
//! Phase 6.0 — claude-mem 통합 옵션화. 백엔드 JSON이 **단일 SOT**.
//! frontend는 시동 시 `settings_read`로 한 번 읽고 store에 반영.
//!
//! 토글 흐름은 동적 — 재시작 없이 `claude_mem_apply` command로 즉시 반영.
//! WAL watch는 idempotent하게 lazy start 후 `CLAUDE_MEM_ACTIVE` atomic으로 동작 여부 제어.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

// claude-mem 동적 활성 플래그 ─────────────────────────────────────────────
//
// WAL debounce loop이 sync_now를 돌리기 전에 확인. OFF면 이벤트를 받아도 noop.
// 토글 ON 직후 빠르게 반영되도록 Relaxed 충분 — strict ordering 불필요.
static CLAUDE_MEM_ACTIVE: AtomicBool = AtomicBool::new(false);

/// WAL watch worker는 첫 ON에서 lazy 시작 후 앱 lifetime 동안 유지된다.
/// 두 번째 ON 토글에서 중복 시작을 막기 위한 가드.
static WAL_WATCH_STARTED: AtomicBool = AtomicBool::new(false);

pub fn is_claude_mem_active() -> bool {
    CLAUDE_MEM_ACTIVE.load(Ordering::Relaxed)
}

pub fn set_claude_mem_active(v: bool) {
    CLAUDE_MEM_ACTIVE.store(v, Ordering::Relaxed);
}

/// 시동 시 lib.rs에서 WAL watch를 시작한 경우 호출 — 이후 토글 ON 중복 시작을 방지.
pub fn mark_wal_watch_started() {
    WAL_WATCH_STARTED.store(true, Ordering::Relaxed);
}

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

/// claude-mem 통합 옵션을 런타임에 적용한다 (재시작 불필요).
///
/// - `enabled=true`: WAL watch lazy 시작 (첫 호출) + 검색 인덱스 빌드 worker spawn.
/// - `enabled=false`: cleanup worker spawn (`lapis-mem.db` + `search-index/` 삭제).
///   WAL watch worker는 살아있지만 `CLAUDE_MEM_ACTIVE`가 false라 sync_now를 건너뜀.
#[tauri::command]
pub fn claude_mem_apply(app: AppHandle, enabled: bool) -> Result<(), String> {
    set_claude_mem_active(enabled);

    if enabled {
        // WAL watch는 한 번만 시작. 이후 토글 ON에서는 active flag만 갱신되면 됨.
        if !WAL_WATCH_STARTED.swap(true, Ordering::Relaxed) {
            let handle = app.clone();
            if let Err(e) = crate::mirror::start_wal_watch(handle) {
                eprintln!("[mirror] WAL watch 시작 실패: {e}");
                // 시작 실패 시 다음 토글에서 재시도 가능하도록 flag 복원.
                WAL_WATCH_STARTED.store(false, Ordering::Relaxed);
            }
        }
        // 초기 mirror sync — cleanup 직후 ON이거나 첫 ON이면 mirror DB가 비어 있어
        // mirror-dot이 노란색(empty)으로 머무름. WAL watch는 이벤트가 와야 동작하므로
        // 토글 직후 자동으로 한 번 incremental sync를 돌려준다.
        // sync_now는 ensure_schema → claude-mem.db 읽기 → mirror upsert까지 한 번에.
        // mirror DB가 이미 채워져 있고 변경 없으면 ms 단위로 끝남 — 항상 호출해도 비용 적음.
        // vault_path는 None — 토글 시점에 vault context를 모르고, .md 정리는 사용자가
        // 명시적으로 MemorySyncModal에서 실행할 때만 수행 (안전 측면).
        // 인덱스 빌드는 sync 완료 후에 호출 — 빈 mirror에 인덱스 빌드는 무의미하므로.
        use tauri::Emitter;
        let handle_for_sync = app.clone();
        std::thread::spawn(move || {
            match crate::mirror::sync_now(&handle_for_sync, false, None) {
                Ok(report) => {
                    let _ = handle_for_sync.emit("mirror-sync-done", &report);
                    // sync 끝난 뒤 인덱스 빌드 — mirror에 row가 있어야 인덱싱 의미.
                    if let Err(e) = crate::search::ensure_index_built(&handle_for_sync) {
                        eprintln!("[search] apply ON ensure_index_built 실패: {e}");
                    }
                }
                Err(e) => {
                    // claude-mem 미설치 등 → last_failure 박제 + error 이벤트.
                    if let Ok(conn) = crate::mirror::open_rw(&handle_for_sync) {
                        let _ = conn.execute(
                            "INSERT INTO sync_meta(key, value) VALUES('last_failure', ?) \
                             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                            rusqlite::params![&e],
                        );
                    }
                    let _ = handle_for_sync.emit("mirror-sync-error", &e);
                }
            }
        });
    } else {
        // 정리 worker — emit으로 progress 전달. 사용자는 CleanupOverlay에서 진행 상황 확인.
        let handle_for_cleanup = app.clone();
        std::thread::spawn(move || {
            crate::cleanup::run_cleanup(&handle_for_cleanup);
        });
    }
    Ok(())
}
