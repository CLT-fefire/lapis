mod memory;
mod mirror;
mod vault;
mod watcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(watcher::WatcherState::default())
        .setup(|app| {
            // Phase 5.2 PR2 #9 — claude-mem.db WAL watch 시작. 실패는 silent (claude-mem 미설치 등).
            let handle = app.handle().clone();
            if let Err(e) = mirror::start_wal_watch(handle) {
                eprintln!("[mirror] WAL watch 시작 실패: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault::list_notes,
            vault::read_note,
            vault::write_note,
            vault::scan_links,
            vault::scan_link_single,
            vault::read_all_notes,
            vault::create_note,
            vault::create_folder,
            vault::delete_note,
            vault::rename_note,
            vault::move_note,
            vault::find_assets_for_note,
            watcher::watch_vault,
            watcher::unwatch_vault,
            memory::memory_list_summaries,
            memory::memory_preview_export,
            memory::memory_export_to_vault,
            memory::memory_fts_search,
            memory::memory_find_exported_note,
            memory::memory_related_to_note,
            mirror::mirror_sync_now,
            mirror::mirror_sync_status,
            mirror::mirror_query_memories,
            mirror::mirror_query_related_to_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
