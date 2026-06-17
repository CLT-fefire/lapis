use notify::{event::ModifyKind, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const DEBOUNCE_MS: u64 = 200;
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".svelte-kit",
    "build",
    "dist",
    ".git",
];

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum VaultChange {
    /// 현재 정책상 emit하지 않음 (모두 Modified로 통합) — frontend가 인덱스 존재 여부로 신규/변경 구분.
    /// 향후 필요 시 활성화.
    #[allow(dead_code)]
    Created { path: String },
    Modified { path: String, mtime_ms: u64 },
    Removed { path: String },
    Renamed { from: String, to: String },
}

pub struct WatcherHandle {
    _watcher: RecommendedWatcher,
    _root: PathBuf,
}

#[derive(Default)]
pub struct WatcherState(pub Mutex<Option<WatcherHandle>>);

/// 디바운스 버킷 — path별 최근 이벤트 묶음.
/// Path의 마지막 이벤트 종류와 timestamp만 보관.
struct DebounceBucket {
    last_event_at: Instant,
    pending: HashMap<PathBuf, PendingChange>,
}

#[derive(Clone, Debug)]
enum PendingChange {
    CreatedOrModified,
    Removed,
    RenamedFrom(PathBuf), // from → 현재 path
}

#[tauri::command]
pub fn watch_vault(
    state: tauri::State<'_, WatcherState>,
    app: AppHandle,
    vault_path: String,
) -> Result<(), String> {
    // 이전 watcher 정리
    {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        *guard = None;
    }

    let root = PathBuf::from(&vault_path);
    if !root.is_dir() {
        return Err(format!("not a directory: {vault_path}"));
    }
    let canon_root = root.canonicalize().map_err(|e| e.to_string())?;

    // 디바운스 버킷은 별도 스레드에서 관리
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(tx).map_err(|e| e.to_string())?;
    watcher
        .watch(&canon_root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let app_clone = app.clone();
    let canon_root_clone = canon_root.clone();
    thread::spawn(move || run_debounce_loop(rx, app_clone, canon_root_clone));

    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    *guard = Some(WatcherHandle {
        _watcher: watcher,
        _root: canon_root,
    });
    Ok(())
}

#[tauri::command]
pub fn unwatch_vault(state: tauri::State<'_, WatcherState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

fn run_debounce_loop(
    rx: std::sync::mpsc::Receiver<notify::Result<notify::Event>>,
    app: AppHandle,
    root: PathBuf,
) {
    let mut bucket = DebounceBucket {
        last_event_at: Instant::now(),
        pending: HashMap::new(),
    };
    let mut last_rename_from: Option<PathBuf> = None;

    loop {
        // 디바운스 윈도우 동안 이벤트 누적
        let timeout = if bucket.pending.is_empty() {
            // 대기 중 — 무한 wait
            Duration::from_secs(60 * 60)
        } else {
            // burst 진행 중 — 짧게
            let elapsed = bucket.last_event_at.elapsed();
            let target = Duration::from_millis(DEBOUNCE_MS);
            if elapsed >= target {
                Duration::from_millis(0)
            } else {
                target - elapsed
            }
        };

        match rx.recv_timeout(timeout) {
            Ok(Ok(event)) => {
                bucket.last_event_at = Instant::now();
                process_event(event, &root, &mut bucket, &mut last_rename_from);
            }
            Ok(Err(_e)) => {
                // notify 내부 에러는 무시
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // 디바운스 완료 — flush
                if !bucket.pending.is_empty() {
                    flush_bucket(&mut bucket, &app);
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn process_event(
    event: notify::Event,
    root: &Path,
    bucket: &mut DebounceBucket,
    last_rename_from: &mut Option<PathBuf>,
) {
    for path in &event.paths {
        if !is_relevant_path(path, root) {
            continue;
        }
        match event.kind {
            EventKind::Create(_) => {
                // rename 의 destination일 수도 있음 — last_rename_from 확인
                if let Some(from) = last_rename_from.take() {
                    bucket.pending.insert(
                        path.clone(),
                        PendingChange::RenamedFrom(from),
                    );
                } else {
                    bucket
                        .pending
                        .insert(path.clone(), PendingChange::CreatedOrModified);
                }
            }
            EventKind::Modify(ModifyKind::Name(_)) => {
                // rename: From / To 두 이벤트로 분리되어 옴
                if path.exists() {
                    // To 이벤트
                    if let Some(from) = last_rename_from.take() {
                        bucket.pending.insert(
                            path.clone(),
                            PendingChange::RenamedFrom(from),
                        );
                    } else {
                        bucket
                            .pending
                            .insert(path.clone(), PendingChange::CreatedOrModified);
                    }
                } else {
                    // From 이벤트
                    *last_rename_from = Some(path.clone());
                }
            }
            EventKind::Modify(_) => {
                // 본문 수정
                bucket
                    .pending
                    .insert(path.clone(), PendingChange::CreatedOrModified);
            }
            EventKind::Remove(_) => {
                bucket
                    .pending
                    .insert(path.clone(), PendingChange::Removed);
            }
            _ => {}
        }
    }
}

fn flush_bucket(bucket: &mut DebounceBucket, app: &AppHandle) {
    let pending = std::mem::take(&mut bucket.pending);
    for (path, change) in pending {
        let path_str = path.to_string_lossy().to_string();
        let payload = match change {
            PendingChange::CreatedOrModified => {
                if path.exists() {
                    let mtime_ms = path
                        .metadata()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    // 생성 vs 수정 구분은 frontend가 path 존재 여부로 판단하기 어려움.
                    // 단순화: 항상 Modified 이벤트, frontend가 "이미 인덱스에 있나?" 보고 결정.
                    VaultChange::Modified {
                        path: path_str,
                        mtime_ms,
                    }
                } else {
                    VaultChange::Removed { path: path_str }
                }
            }
            PendingChange::Removed => VaultChange::Removed { path: path_str },
            PendingChange::RenamedFrom(from) => VaultChange::Renamed {
                from: from.to_string_lossy().to_string(),
                to: path_str,
            },
        };
        let _ = app.emit("vault:change", payload);
    }
}

/// vault 안의 .md 파일만 관심.
/// SKIP_DIRS 안에 있으면 무시. 숨김 파일도 무시.
fn is_relevant_path(path: &Path, root: &Path) -> bool {
    // root 하위인지 확인
    if !path.starts_with(root) {
        return false;
    }
    // 디렉토리 자체 이벤트는 통과 (rename 등 인지 위해)
    let is_dir_event = !path.has_extension() && !path.is_file();
    if !is_dir_event {
        // 파일이면 지원 확장자(.md/.mmd)만 — 트리/인덱스 워커와 동일 술어 공유.
        // (이전엔 .md만 감시 → .mmd 외부 생성/수정/삭제가 reindex를 안 깨움)
        if path.extension().is_none_or(|e| !crate::vault::is_supported_note_ext(e)) {
            return false;
        }
    }
    // 경로 segment 검사 — SKIP_DIRS / 숨김 디렉토리
    for component in path.components() {
        let s = component.as_os_str().to_string_lossy();
        if s.starts_with('.') && s.len() > 1 {
            return false;
        }
        if SKIP_DIRS.iter().any(|d| *d == s) {
            return false;
        }
    }
    true
}

// Path 확장 (extension 존재 여부 단순 헬퍼)
trait PathExt {
    fn has_extension(&self) -> bool;
}
impl PathExt for Path {
    fn has_extension(&self) -> bool {
        self.extension().is_some()
    }
}
