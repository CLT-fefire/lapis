mod cleanup;
mod memory;
mod mirror;
mod search;
mod search_cache;
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

            // Legacy backward-compat — 이전 PR의 재시작 기반 흐름에서 pending_cleanup이 켜져 있으면 처리.
            // 새 동적 흐름은 이 flag를 안 쓴다.
            if cfg.pending_cleanup {
                let handle_for_cleanup = handle.clone();
                std::thread::spawn(move || {
                    cleanup::run_pending_cleanup(&handle_for_cleanup);
                });
            }

            // claude-mem 활성 플래그 — atomic으로 동적 토글 가능. 기본 false (배포 안전).
            settings::set_claude_mem_active(cfg.claude_mem_enabled);

            // ON 상태라면 시동 시 WAL watch + 인덱스 빌드. OFF면 자동 동작 0 → 팀원 배포 시 잡음 0.
            // (런타임 토글 ON은 `claude_mem_apply` command가 동일한 작업을 lazy로 수행.)
            if cfg.claude_mem_enabled {
                if let Err(e) = mirror::start_wal_watch(handle.clone()) {
                    eprintln!("[mirror] WAL watch 시작 실패: {e}");
                } else {
                    // settings 모듈의 WAL_WATCH_STARTED gate 동기화 — 이후 토글 ON 시 중복 시작 방지.
                    settings::mark_wal_watch_started();
                }

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
            search_cache::read_search_cache_meta,
            search_cache::write_search_cache_meta,
            search_cache::read_search_cache_shard,
            search_cache::write_search_cache_shard,
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
            mirror::mirror_query_related_to_note,
            search::search_query,
            settings::settings_read,
            settings::settings_write,
            settings::claude_mem_apply,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
