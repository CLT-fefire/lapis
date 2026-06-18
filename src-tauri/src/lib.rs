mod git;
mod search_cache;
mod settings;
mod vault;
mod watcher;

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
        .invoke_handler(tauri::generate_handler![
            vault::list_notes,
            vault::read_note,
            vault::write_note,
            vault::write_binary_file,
            vault::scan_link_single,
            vault::read_vault_bundle,
            vault::vault_fingerprint,
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
