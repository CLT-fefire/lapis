mod memory;
mod vault;
mod watcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(watcher::WatcherState::default())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
