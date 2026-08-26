mod git;
mod grep;
mod hash;
mod paths;
mod search_cache;
mod settings;
mod uipath;
mod vault;
mod watcher;

use tauri::Manager;

/// 디버그 빌드 여부.
///
/// 릴리즈 앱과 디버그 앱을 **동시에 띄워 놓고 쓰기 때문에** 구분 표식이 필요하다.
/// 프론트도 창 제목도 이 한 값만 보게 해서 둘이 어긋나지 않게 한다 —
/// `import.meta.env.DEV`(프론트 번들 모드)로 판정하면 `tauri build --debug`처럼
/// Rust만 디버그인 조합에서 창 제목과 UI 배지가 따로 논다.
#[tauri::command]
fn is_debug_build() -> bool {
    cfg!(debug_assertions)
}

/// 디버그 빌드 표식을 창 제목에 단다. `main` 창(setup)과 새로 만든 창이 **같은 규칙**을
/// 쓰도록 한 곳에 모아뒀다 — 한쪽만 고치면 릴리즈 앱과 구분이 안 되는 창이 생긴다.
fn apply_debug_title(window: &tauri::WebviewWindow) {
    if !cfg!(debug_assertions) {
        return;
    }
    // 실패해도 앱 기동을 막을 이유가 없다 — 표식은 편의 기능이다.
    if let Err(e) = window.set_title("Lapis (DEBUG)") {
        eprintln!("[lapis] 디버그 창 제목 설정 실패: {e}");
    }
}

/// 창 라벨 발급 — `main`, `w2`, `w3` … **빈 번호를 재사용**한다.
///
/// ⚠️ 단조 증가로 만들면 안 된다. 라벨이 창별 localStorage 키의 접미사가 되므로,
/// 창을 열고 닫을 때마다 새 번호를 쓰면 죽은 키가 무한히 쌓인다.
fn next_window_label(app: &tauri::AppHandle) -> String {
    let taken: std::collections::HashSet<String> = app.webview_windows().keys().cloned().collect();
    (2..)
        .map(|n| format!("w{n}"))
        .find(|label| !taken.contains(label))
        .expect("라벨 후보는 무한하다")
}

/// 새 창 — vault는 프론트가 각자 고른다(창별 `last-vault-path`).
#[tauri::command]
fn new_window(app: tauri::AppHandle) -> Result<String, String> {
    let label = next_window_label(&app);
    let window =
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title("Lapis")
            .inner_size(1200.0, 800.0)
            // 탭 DnD가 WKWebView 기본 drag&drop과 충돌한다 — tauri.conf.json의 main 창과 동일 설정.
            .disable_drag_drop_handler()
            .build()
            .map_err(|e| format!("창 생성 실패: {e}"))?;

    apply_debug_title(&window);
    if cfg!(debug_assertions) {
        eprintln!("[lapis] new_window: label={label}");
    }
    Ok(label)
}

/// 창 기하를 stderr에 찍는다 — **창 위치 복원 검증용**(debug 빌드 전용).
///
/// 플러그인이 조용히 동작하므로 "복원됐는지"를 밖에서 볼 방법이 없다. 실행할 때마다
/// 같은 형식으로 찍어두면 **두 번의 실행 로그를 비교**하는 것만으로 판정이 된다.
fn log_geometry(tag: &str, window: &tauri::Window) {
    if !cfg!(debug_assertions) {
        return;
    }
    let pos = window.outer_position();
    let size = window.outer_size();
    let maximized = window.is_maximized();
    eprintln!(
        "[lapis/geom] {tag} label={} pos={:?} size={:?} maximized={:?}",
        window.label(),
        pos.map(|p| (p.x, p.y)),
        size.map(|s| (s.width, s.height)),
        maximized,
    );
}

/// 창 상태 파일의 위치와 내용을 찍는다 — 저장이 **실제로 일어났는지** 확인용.
fn log_window_state_file(app: &tauri::AppHandle) {
    if !cfg!(debug_assertions) {
        return;
    }
    let Ok(dir) = app.path().app_config_dir() else {
        eprintln!("[lapis/geom] app_config_dir 조회 실패");
        return;
    };
    let file = dir.join(".window-state.json");
    match std::fs::read_to_string(&file) {
        Ok(body) => eprintln!(
            "[lapis/geom] state file {} = {}",
            file.display(),
            body.trim()
        ),
        Err(e) => eprintln!(
            "[lapis/geom] state file {} 없음/못읽음 ({e})",
            file.display()
        ),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // release `panic = "abort"`라 패닉은 크래시 리포트로만 남아 진단이 어렵다.
    // hook으로 패닉 메시지를 stderr에 박제 → 터미널/Console.app에서 즉시 원인 확인.
    std::panic::set_hook(Box::new(|info| {
        eprintln!("[lapis panic] {info}");
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // 창 위치·크기를 재시작 너머로 잇는다. `on_window_ready`에 걸리므로 `main`뿐 아니라
        // `new_window`가 만드는 `w2`/`w3`도 각자 라벨의 마지막 위치로 열린다 — 라벨이 빈 번호를
        // 재사용하니(`next_window_label`) "직전에 닫은 그 자리"가 된다.
        //
        // ⚠️ **직접 구현하지 않은 이유**: 저장한 좌표의 모니터가 사라졌을 때(외장 디스플레이를
        // 뽑은 뒤 재시작) 창이 화면 밖에 복원돼 잡을 수 없게 된다. 이 플러그인은
        // `available_monitors()`와 교차 검사해 그 경우 기본 위치로 떨어뜨린다.
        //
        // ⚠️ 상태 파일(`.window-state.json`)은 죽은 `wN` 라벨 항목을 **회수하지 않는다**
        // — `windowScope.ts`의 `pruneOrphanScopedKeys`가 localStorage에서 하는 청소를
        // 플러그인은 안 한다. 항목당 수십 바이트라 방치해도 무해하지만, 라벨 재사용 규칙이
        // 바뀌어 번호가 단조 증가하게 되면 그때는 자란다.
        //
        // ⚠️ `VISIBLE`·`DECORATIONS`는 **일부러 뺐다**. 앱이 창을 숨기는 경로가 생기면
        // `VISIBLE`이 "숨김"을 복원해 **앱이 안 뜨는 것처럼 보인다**. 장식은 Lapis가 토글하지
        // 않으므로 저장할 값이 아니다. 남긴 4개가 실제로 사용자가 바꾸는 것들이다.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .build(),
        )
        .manage(watcher::WatcherState::default())
        .setup(|app| {
            // 디버그 빌드는 창 제목에 표식을 단다 — 창 제목 막대뿐 아니라
            // ⌘Tab 전환기·Dock 우클릭 창 목록·Mission Control에서도 릴리즈 앱과 구분된다
            // (앱 이름 자체는 번들에서 오므로 여기서 못 바꾼다).
            if let Some(window) = app.get_webview_window("main") {
                apply_debug_title(&window);
                // 창 위치 복원 검증용 — 플러그인이 `on_window_ready`에서 이미 복원한 뒤다.
                log_geometry("startup", &window.as_ref().window());
            }
            log_window_state_file(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            // 창이 닫히면 그 창의 vault 구독을 뗀다. 프론트의 `unwatch_vault`가 불릴
            // 보장이 없어서(창은 그냥 사라질 수 있다) 여기서 메운다 — 안 메우면 죽은
            // 창이 구독자로 남아 그 vault의 watcher가 영영 해제되지 않는다.
            if matches!(event, tauri::WindowEvent::Destroyed) {
                watcher::release_window(window.app_handle(), window.label());
            }
            // 닫히기 **직전** 기하 — 다음 실행의 startup 로그가 이 값과 같아야 복원 성공이다.
            // `Destroyed`는 이미 창이 사라진 뒤라 좌표를 못 읽는다.
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                log_geometry("close", window);
            }
        })
        .invoke_handler(tauri::generate_handler![
            is_debug_build,
            new_window,
            grep::grep_vault,
            vault::list_notes,
            vault::read_note,
            vault::write_note,
            vault::write_binary_file,
            vault::scan_link_single,
            vault::read_vault_bundle,
            vault::vault_fingerprint,
            vault::vault_file_stats,
            vault::notes_mtimes,
            vault::create_note,
            vault::create_folder,
            vault::delete_note,
            vault::rename_note,
            vault::move_note,
            vault::find_assets_for_note,
            vault::backup_notes,
            vault::prune_link_rewrite_backups,
            git::git_is_repo,
            git::git_init,
            git::git_has_changes,
            git::git_commit_all,
            git::git_commit_paths,
            git::git_log,
            git::git_show_diff,
            search_cache::read_search_cache_meta,
            search_cache::write_search_cache_meta,
            search_cache::read_search_cache_stats,
            search_cache::write_search_cache_stats,
            search_cache::read_search_cache_shard,
            search_cache::write_search_cache_shard,
            watcher::watch_vault,
            watcher::unwatch_vault,
            settings::settings_read,
            settings::settings_write,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
