use notify::{event::ModifyKind, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
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

/// 한 vault root에 걸린 watcher + **그 root를 보고 있는 창들**.
///
/// 창마다 다른 vault를 열 수 있게 되면서(2026-08-10) watcher가 root별로 여러 개
/// 살아 있어야 하고, 같은 root를 두 창이 보면 watcher는 **하나만** 두고 구독자만
/// 늘린다. 마지막 창이 놓을 때 drop → mpsc sender가 떨어지며 디바운스 스레드도
/// 스스로 종료한다(`RecvTimeoutError::Disconnected`).
pub struct ActiveWatch {
    /// 단위 테스트에서는 `None` — 구독 장부 로직만 검증한다.
    /// (`RecommendedWatcher`를 테스트에서 만들 방법이 마땅치 않아, 장부를 별도 맵으로
    ///  복제하는 대신 여기서 Option을 허용해 **진실의 원천을 하나로** 유지한다.)
    _watcher: Option<RecommendedWatcher>,
    subscribers: HashSet<String>,
}

#[derive(Default)]
pub struct WatcherState(pub Mutex<HashMap<PathBuf, ActiveWatch>>);

/// `label`을 모든 root의 구독자에서 떼어낸다. 구독자가 빈 root는 맵에서 제거 —
/// 그 시점에 `ActiveWatch`가 drop되며 watcher와 스레드가 정리된다.
///
/// 창이 vault를 갈아탈 때(watch_vault)와 창이 닫힐 때(unwatch_vault ·
/// `WindowEvent::Destroyed`) 모두 이 경로를 탄다.
fn unsubscribe_label(map: &mut HashMap<PathBuf, ActiveWatch>, label: &str) {
    map.retain(|_root, entry| {
        entry.subscribers.remove(label);
        !entry.subscribers.is_empty()
    });
}

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
    window: tauri::Window,
    vault_path: String,
) -> Result<(), String> {
    let label = window.label().to_string();

    let root = PathBuf::from(&vault_path);
    if !root.is_dir() {
        return Err(format!("not a directory: {vault_path}"));
    }
    let canon_root = root.canonicalize().map_err(|e| e.to_string())?;

    {
        let mut map = state.0.lock().map_err(|e| e.to_string())?;

        // 이 창이 다른 vault를 보고 있었다면 거기서 먼저 뗀다. 안 그러면 창이 vault를
        // 갈아탄 뒤에도 옛 root의 이벤트를 계속 받는다.
        unsubscribe_label(&mut map, &label);

        // 이미 누가 보고 있는 root면 **구독자만 늘린다**.
        // ⚠️ 여기서 watcher를 다시 설치하면 교체 구간에 이벤트가 샌다.
        if let Some(entry) = map.get_mut(&canon_root) {
            entry.subscribers.insert(label);
            return Ok(());
        }
    }

    // 새 root — watcher + 디바운스 스레드를 만든다. (락은 위에서 이미 놓았다.
    // notify 설치가 락 안에서 일어나면 다른 창의 watch/unwatch가 그동안 막힌다.)
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(tx).map_err(|e| e.to_string())?;
    watcher
        .watch(&canon_root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let app_clone = app.clone();
    let canon_root_clone = canon_root.clone();
    thread::spawn(move || run_debounce_loop(rx, app_clone, canon_root_clone));

    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    // 락을 놓은 사이 다른 창이 같은 root를 선점했을 수 있다 — 그러면 방금 만든
    // watcher는 버리고(drop → 스레드 종료) 구독자만 얹는다.
    let entry = map.entry(canon_root).or_insert_with(|| ActiveWatch {
        _watcher: Some(watcher),
        subscribers: HashSet::new(),
    });
    entry.subscribers.insert(label);
    Ok(())
}

#[tauri::command]
pub fn unwatch_vault(
    state: tauri::State<'_, WatcherState>,
    window: tauri::Window,
) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    unsubscribe_label(&mut map, window.label());
    Ok(())
}

/// 창이 닫힐 때 호출(lib.rs `WindowEvent::Destroyed`). 프론트가 `unwatch_vault`를
/// 부르지 못하고 사라지는 경로를 메운다 — 안 메우면 죽은 창이 구독자로 남아
/// watcher가 영영 해제되지 않는다.
pub fn release_window(app: &AppHandle, label: &str) {
    use tauri::Manager;
    let state = app.state::<WatcherState>();
    // `if let`으로 쓰면 Result 임시값이 블록 끝까지 살아 `state`보다 늦게 drop된다(E0597).
    let Ok(mut map) = state.0.lock() else { return };
    unsubscribe_label(&mut map, label);
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
                    flush_bucket(&mut bucket, &app, &root);
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

/// 이 root를 보고 있는 창들의 label. 스레드가 살아 있는 동안 구독자는 바뀔 수 있으므로
/// flush 시점에 매번 조회한다.
fn subscribers_of(app: &AppHandle, root: &Path) -> Vec<String> {
    use tauri::Manager;
    let state = app.state::<WatcherState>();
    let Ok(map) = state.0.lock() else {
        return Vec::new();
    };
    map.get(root)
        .map(|e| e.subscribers.iter().cloned().collect())
        .unwrap_or_default()
}

fn flush_bucket(bucket: &mut DebounceBucket, app: &AppHandle, root: &Path) {
    // ⚠️ 브로드캐스트(`app.emit`)면 다른 vault를 보는 창까지 재인덱싱한다.
    // 이 root의 구독자에게만 보낸다.
    let targets = subscribers_of(app, root);
    if targets.is_empty() {
        bucket.pending.clear();
        return;
    }

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
        for label in &targets {
            let _ = app.emit_to(label.as_str(), "vault:change", payload.clone());
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    /// watcher 핸들 없이 구독 장부만 만든 엔트리 — `_watcher: None`이 그래서 있다.
    fn entry(labels: &[&str]) -> ActiveWatch {
        ActiveWatch {
            _watcher: None,
            subscribers: labels.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn map_of(pairs: &[(&str, &[&str])]) -> HashMap<PathBuf, ActiveWatch> {
        pairs
            .iter()
            .map(|(root, labels)| (PathBuf::from(root), entry(labels)))
            .collect()
    }

    #[test]
    fn last_subscriber_leaving_releases_root() {
        let mut map = map_of(&[("/a", &["main"])]);
        unsubscribe_label(&mut map, "main");
        // 엔트리가 사라져야 ActiveWatch가 drop되고 watcher·스레드가 정리된다.
        assert!(map.is_empty());
    }

    #[test]
    fn root_survives_while_another_subscriber_remains() {
        // ⚠️ 이 케이스가 회귀하면 "한 창을 닫았더니 남은 창의 감시가 끊긴다"가 된다.
        let mut map = map_of(&[("/a", &["main", "w2"])]);
        unsubscribe_label(&mut map, "w2");
        assert_eq!(map.len(), 1);
        let subs = &map[&PathBuf::from("/a")].subscribers;
        assert!(subs.contains("main"));
        assert!(!subs.contains("w2"));
    }

    #[test]
    fn switching_vault_detaches_from_old_root() {
        // watch_vault가 새 root를 붙이기 전에 부르는 경로.
        let mut map = map_of(&[("/a", &["main"]), ("/b", &["w2"])]);
        unsubscribe_label(&mut map, "main");
        assert!(!map.contains_key(&PathBuf::from("/a")));
        assert!(map.contains_key(&PathBuf::from("/b")));
    }

    #[test]
    fn label_is_removed_from_every_root() {
        // 정상 흐름에선 안 생기지만, 생기면 죽은 구독이 watcher를 붙잡는다.
        let mut map = map_of(&[("/a", &["main"]), ("/b", &["main", "w2"])]);
        unsubscribe_label(&mut map, "main");
        assert!(!map.contains_key(&PathBuf::from("/a")));
        assert_eq!(map[&PathBuf::from("/b")].subscribers.len(), 1);
    }

    #[test]
    fn unknown_label_is_a_noop() {
        let mut map = map_of(&[("/a", &["main"])]);
        unsubscribe_label(&mut map, "w9");
        assert_eq!(map[&PathBuf::from("/a")].subscribers.len(), 1);
    }
}
