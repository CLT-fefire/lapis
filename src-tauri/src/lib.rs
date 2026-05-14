mod cleanup;
mod memory;
mod mirror;
mod search;
mod settings;
mod vault;
mod watcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(watcher::WatcherState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let cfg = settings::load(&handle);

            // Phase 6.0 — ON→OFF 전환 정리. 워커 스레드에서 진행 (UI 시동을 막지 않음).
            if cfg.pending_cleanup {
                let handle_for_cleanup = handle.clone();
                std::thread::spawn(move || {
                    cleanup::run_pending_cleanup(&handle_for_cleanup);
                });
            }

            // claude-mem 통합이 활성일 때만 WAL watch + search index 빌드.
            // OFF면 자동 동작 0 → 팀원 배포 시 잡음 0.
            if cfg.claude_mem_enabled {
                // Phase 5.2 PR2 #9 — claude-mem.db WAL watch 시작. 실패는 silent (claude-mem 미설치 등).
                if let Err(e) = mirror::start_wal_watch(handle.clone()) {
                    eprintln!("[mirror] WAL watch 시작 실패: {e}");
                }

                // Phase Search #7 — 첫 시작 시 search index가 비어 있고 mirror에 데이터 있으면
                // 백그라운드에서 통째 빌드. mirror sync 후속 호출에서는 changed row만 incremental.
                let handle_for_index = handle.clone();
                std::thread::spawn(move || match search::ensure_index_built(&handle_for_index) {
                    Ok(r) => {
                        if r.added > 0 {
                            eprintln!(
                                "[search] 첫 인덱스 빌드 완료: +{} · {}ms",
                                r.added, r.duration_ms
                            );
                        }
                    }
                    Err(e) => eprintln!("[search] ensure_index_built 실패: {e}"),
                });
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
            mirror::mirror_list_memory_links,
            search::search_query,
            settings::settings_read,
            settings::settings_write,
            settings::app_restart,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
