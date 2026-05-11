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
            watcher::watch_vault,
            watcher::unwatch_vault,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
