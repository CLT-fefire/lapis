//! MiniSearch 풀텍스트 인덱스의 disk 캐시.
//!
//! cold-start 최대 병목인 `MiniSearch.addAll`(11000+ 노트 = ~9s)을 vault 변경이 없을 때
//! 회피하기 위해 인덱스 JSON + link_infos를 app_data_dir에 저장. 다음 vault open 때:
//! 1. frontend가 `vault_fingerprint`로 vault 상태 hash 계산
//! 2. `read_search_cache`로 마지막 저장값 조회
//! 3. fingerprint 일치하면 frontend가 `MiniSearch.loadJSON` + 캐시된 link_infos 그대로 사용
//!    → IPC body 11.6MB 도 자연 생략 (캐시 hit 시 readVaultBundle 자체를 호출 안 함)
//!
//! 저장 위치: `app_data_dir/search-cache/{vault_key}.json`
//! - `vault_key` = vault path의 fnv64 hex. 다른 vault 충돌 방지.
//! - `version` 필드 — MiniSearch 빌드 옵션 변경 시 bump → 모든 캐시 invalidate.

use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::vault::LinkInfo;

/// MiniSearch 빌드 옵션이 변경되면 bump. 모든 캐시가 buster된다.
/// 현 schema(v1) = MiniSearch fields=["name","body"] storeFields=["name","body"]
///                 boost name×3 + prefix + fuzzy 0.15. link_infos는 그대로.
pub const CACHE_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchCacheEntry {
    pub version: u32,
    pub fingerprint: String,
    /// `MiniSearch.toJSON()` 결과 그대로. frontend가 `MiniSearch.loadJSON`으로 복원.
    pub minisearch_json: String,
    pub link_infos: Vec<LinkInfo>,
}

fn cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("search-cache");
    fs::create_dir_all(&dir).map_err(|e| format!("search-cache mkdir: {e}"))?;
    Ok(dir)
}

fn vault_key(vault_path: &str) -> String {
    let mut h = DefaultHasher::new();
    vault_path.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn cache_file(app: &AppHandle, vault_path: &str) -> Result<PathBuf, String> {
    Ok(cache_root(app)?.join(format!("{}.json", vault_key(vault_path))))
}

#[tauri::command]
pub async fn read_search_cache(
    app: AppHandle,
    vault_path: String,
) -> Result<Option<SearchCacheEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || read_search_cache_inner(&app, &vault_path))
        .await
        .map_err(|e| format!("read_search_cache join: {e}"))?
}

fn read_search_cache_inner(
    app: &AppHandle,
    vault_path: &str,
) -> Result<Option<SearchCacheEntry>, String> {
    let path = cache_file(app, vault_path)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            // 손상/권한 문제는 cache miss로 fallback
            eprintln!("[search-cache] read 실패: {e}");
            return Ok(None);
        }
    };
    let entry: SearchCacheEntry = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[search-cache] parse 실패 (cache miss fallback): {e}");
            return Ok(None);
        }
    };
    if entry.version != CACHE_VERSION {
        // schema 변경 — invalidate (frontend가 곧 새 캐시로 덮어씀)
        return Ok(None);
    }
    Ok(Some(entry))
}

#[tauri::command]
pub async fn write_search_cache(
    app: AppHandle,
    vault_path: String,
    fingerprint: String,
    minisearch_json: String,
    link_infos: Vec<LinkInfo>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let entry = SearchCacheEntry {
            version: CACHE_VERSION,
            fingerprint,
            minisearch_json,
            link_infos,
        };
        write_search_cache_inner(&app, &vault_path, &entry)
    })
    .await
    .map_err(|e| format!("write_search_cache join: {e}"))?
}

fn write_search_cache_inner(
    app: &AppHandle,
    vault_path: &str,
    entry: &SearchCacheEntry,
) -> Result<(), String> {
    let path = cache_file(app, vault_path)?;
    let parent = path
        .parent()
        .ok_or_else(|| "cache parent dir 없음".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("mkdir parent: {e}"))?;

    // atomic write — temp + rename. CLAUDE.md: 부분 쓰기 금지.
    let tmp_name = format!(
        ".{}.tmp.lapis-{}",
        path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "cache".to_string()),
        std::process::id(),
    );
    let tmp_path = parent.join(tmp_name);

    let json = serde_json::to_string(entry).map_err(|e| format!("serialize: {e}"))?;
    fs::write(&tmp_path, json).map_err(|e| format!("temp write: {e}"))?;
    fs::rename(&tmp_path, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("rename: {e}")
    })?;
    Ok(())
}
