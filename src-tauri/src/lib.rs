mod git;
mod paths;
mod search_cache;
mod settings;
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
    let taken: std::collections::HashSet<String> =
        app.webview_windows().keys().cloned().collect();
    (2..)
        .map(|n| format!("w{n}"))
        .find(|label| !taken.contains(label))
        .expect("라벨 후보는 무한하다")
}

/// 새 창 — vault는 프론트가 각자 고른다(창별 `last-vault-path`).
#[tauri::command]
fn new_window(app: tauri::AppHandle) -> Result<String, String> {
    let label = next_window_label(&app);
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App("index.html".into()),
    )
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
        .manage(watcher::WatcherState::default())
        .setup(|app| {
            // 디버그 빌드는 창 제목에 표식을 단다 — 창 제목 막대뿐 아니라
            // ⌘Tab 전환기·Dock 우클릭 창 목록·Mission Control에서도 릴리즈 앱과 구분된다
            // (앱 이름 자체는 번들에서 오므로 여기서 못 바꾼다).
            if let Some(window) = app.get_webview_window("main") {
                apply_debug_title(&window);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // 창이 닫히면 그 창의 vault 구독을 뗀다. 프론트의 `unwatch_vault`가 불릴
            // 보장이 없어서(창은 그냥 사라질 수 있다) 여기서 메운다 — 안 메우면 죽은
            // 창이 구독자로 남아 그 vault의 watcher가 영영 해제되지 않는다.
            if matches!(event, tauri::WindowEvent::Destroyed) {
                watcher::release_window(window.app_handle(), window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            is_debug_build,
            new_window,
            vault::list_notes,
            vault::read_note,
            vault::write_note,
            vault::write_binary_file,
            vault::scan_link_single,
            vault::read_vault_bundle,
            vault::vault_fingerprint,
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
