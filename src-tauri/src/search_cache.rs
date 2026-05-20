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

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{Read, Write};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::vault::LinkInfo;

/// MiniSearch 빌드 옵션이 변경되면 bump. 모든 캐시가 buster된다.
/// - v1: fields=["name","body"] storeFields=["name","body"]
/// - v2: storeFields=["name"]만 (snippet은 readNote로 lazy fetch).
/// - v3: gzip 압축 (옵션 자체는 v2와 같지만 disk 포맷 다름 → 자동 invalidate).
pub const CACHE_VERSION: u32 = 3;

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

/// 가벼운 메타 응답 — cold-start `cacheLookup` 단계에서 받음.
/// `minisearch_json`(30MB)을 빼고 `link_infos`(~2-3MB)만 포함 → frontend JSON.parse 비용 단축.
#[derive(Debug, Serialize, Clone)]
pub struct SearchCacheMeta {
    pub version: u32,
    pub fingerprint: String,
    pub link_infos: Vec<LinkInfo>,
}

/// cold-start cacheLookup 단계 — 메타만. fingerprint 비교 + link/tag/facet 빌드 즉시 가능.
#[tauri::command]
pub async fn read_search_cache_meta(
    app: AppHandle,
    vault_path: String,
) -> Result<Option<SearchCacheMeta>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let entry = read_search_cache_inner(&app, &vault_path)?;
        Ok(entry.map(|e| SearchCacheMeta {
            version: e.version,
            fingerprint: e.fingerprint,
            link_infos: e.link_infos,
        }))
    })
    .await
    .map_err(|e| format!("read_search_cache_meta join: {e}"))?
}

/// lazy load 시점 — `MiniSearch.loadJSON` 직전. 30MB JSON string만.
/// disk read + gunzip + parse는 메타와 별개 — 두 번째라 idle 시점이라 사용자 perceived 영향 없음.
#[tauri::command]
pub async fn read_search_cache_minisearch_json(
    app: AppHandle,
    vault_path: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let entry = read_search_cache_inner(&app, &vault_path)?;
        Ok(entry.map(|e| e.minisearch_json))
    })
    .await
    .map_err(|e| format!("read_search_cache_minisearch_json join: {e}"))?
}

fn read_search_cache_inner(
    app: &AppHandle,
    vault_path: &str,
) -> Result<Option<SearchCacheEntry>, String> {
    let path = cache_file(app, vault_path)?;
    if !path.exists() {
        return Ok(None);
    }
    // gzip 바이너리. 옛 v2 plain JSON 캐시는 gunzip 실패 → cache miss로 fallback.
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[search-cache] read 실패: {e}");
            return Ok(None);
        }
    };
    let mut decoder = GzDecoder::new(bytes.as_slice());
    let mut json = String::new();
    if let Err(e) = decoder.read_to_string(&mut json) {
        // 손상 또는 옛 plain JSON — 정상 시나리오 (스키마 마이그레이션)
        eprintln!("[search-cache] gunzip 실패 (옛 plain JSON 가능 → cache miss): {e}");
        return Ok(None);
    }
    let entry: SearchCacheEntry = match serde_json::from_str(&json) {
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
    // gzip 압축 — 30MB JSON → ~5MB. disk write/read + IPC 큰 폭 단축.
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(json.as_bytes())
        .map_err(|e| format!("gzip write: {e}"))?;
    let compressed = encoder
        .finish()
        .map_err(|e| format!("gzip finish: {e}"))?;
    fs::write(&tmp_path, &compressed).map_err(|e| format!("temp write: {e}"))?;
    fs::rename(&tmp_path, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("rename: {e}")
    })?;
    Ok(())
}
