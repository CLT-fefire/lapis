mod git;
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
            if cfg!(debug_assertions) {
                if let Some(window) = app.get_webview_window("main") {
                    // 실패해도 앱 기동을 막을 이유가 없다 — 표식은 편의 기능이다.
                    if let Err(e) = window.set_title("Lapis (DEBUG)") {
                        eprintln!("[lapis] 디버그 창 제목 설정 실패: {e}");
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            is_debug_build,
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
