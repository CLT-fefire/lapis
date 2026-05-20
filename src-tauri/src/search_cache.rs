//! MiniSearch 풀텍스트 인덱스의 disk 캐시 — sharded progressive load.
//!
//! v4부터: 인덱스를 `SHARD_COUNT`(4)개로 분할. 메타 파일 + shard 파일 N개.
//! cold-start cache hit 시 첫 shard만 1.8s 로드해도 부분 검색 가능 → 사용자 perceived 단축.
//!
//! ## 파일 구조 (v4)
//! - `app_data_dir/search-cache/{vault_key}.meta.json.gz` — version, fingerprint,
//!   link_infos, shard_count
//! - `app_data_dir/search-cache/{vault_key}.shard{i}.json.gz` — i번째 shard의
//!   MiniSearch JSON 문자열만
//!
//! ## CACHE_VERSION 이력
//! - v1: storeFields=["name","body"]
//! - v2: storeFields=["name"]만
//! - v3: gzip 압축
//! - v4: sharded (메타 + N shard 파일 분리)
//! - v5: shard 파일이 MessagePack 바이너리(`idx.toJSON()` → msgpack.encode → gzip). meta는 그대로 JSON+gzip.
//!       IPC는 base64 string (Tauri JSON IPC가 Vec<u8>를 number array로 비효율 직렬화하는 문제 회피)

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
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

pub const CACHE_VERSION: u32 = 5;

/// 메타 파일 schema — `*.meta.json.gz`에 직렬화.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchCacheMeta {
    pub version: u32,
    pub fingerprint: String,
    pub link_infos: Vec<LinkInfo>,
    pub shard_count: u32,
}

// v5부터 shard 파일은 wrapper struct 없이 raw bytes(gzip(msgpack)) 직접 저장.
// version 확인은 meta.version으로 — meta가 같은 vault_key를 공유하므로 일관성 보장.

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

fn meta_file(app: &AppHandle, vault_path: &str) -> Result<PathBuf, String> {
    Ok(cache_root(app)?.join(format!("{}.meta.json.gz", vault_key(vault_path))))
}

fn shard_file(app: &AppHandle, vault_path: &str, shard_id: u32) -> Result<PathBuf, String> {
    Ok(cache_root(app)?.join(format!("{}.shard{}.json.gz", vault_key(vault_path), shard_id)))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn gunzip_to_string(bytes: &[u8]) -> Result<String, String> {
    let mut decoder = GzDecoder::new(bytes);
    let mut s = String::new();
    decoder
        .read_to_string(&mut s)
        .map_err(|e| format!("gunzip: {e}"))?;
    Ok(s)
}

fn gzip_string(s: &str) -> Result<Vec<u8>, String> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(s.as_bytes())
        .map_err(|e| format!("gzip write: {e}"))?;
    encoder.finish().map_err(|e| format!("gzip finish: {e}"))
}

fn atomic_write(path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "cache parent dir 없음".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("mkdir parent: {e}"))?;
    let tmp_name = format!(
        ".{}.tmp.lapis-{}",
        path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "cache".to_string()),
        std::process::id(),
    );
    let tmp_path = parent.join(tmp_name);
    fs::write(&tmp_path, bytes).map_err(|e| format!("temp write: {e}"))?;
    fs::rename(&tmp_path, path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("rename: {e}")
    })
}

// ─── 메타 read/write ─────────────────────────────────────────────────────────

/// cold-start cacheLookup 단계 — 메타만 읽기. fingerprint 비교 + link/tag/facet 빌드 즉시.
/// 옛 v3 단일 캐시(`{vault_key}.json`)는 무시 — version mismatch로 자동 cache miss.
#[tauri::command]
pub async fn read_search_cache_meta(
    app: AppHandle,
    vault_path: String,
) -> Result<Option<SearchCacheMeta>, String> {
    tauri::async_runtime::spawn_blocking(move || read_search_cache_meta_inner(&app, &vault_path))
        .await
        .map_err(|e| format!("read_search_cache_meta join: {e}"))?
}

fn read_search_cache_meta_inner(
    app: &AppHandle,
    vault_path: &str,
) -> Result<Option<SearchCacheMeta>, String> {
    let path = meta_file(app, vault_path)?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[search-cache] meta read 실패: {e}");
            return Ok(None);
        }
    };
    let json = match gunzip_to_string(&bytes) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[search-cache] meta gunzip 실패: {e}");
            return Ok(None);
        }
    };
    let meta: SearchCacheMeta = match serde_json::from_str(&json) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[search-cache] meta parse 실패: {e}");
            return Ok(None);
        }
    };
    if meta.version != CACHE_VERSION {
        return Ok(None);
    }
    Ok(Some(meta))
}

#[tauri::command]
pub async fn write_search_cache_meta(
    app: AppHandle,
    vault_path: String,
    fingerprint: String,
    link_infos: Vec<LinkInfo>,
    shard_count: u32,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let meta = SearchCacheMeta {
            version: CACHE_VERSION,
            fingerprint,
            link_infos,
            shard_count,
        };
        let json = serde_json::to_string(&meta).map_err(|e| format!("meta serialize: {e}"))?;
        let bytes = gzip_string(&json)?;
        atomic_write(&meta_file(&app, &vault_path)?, &bytes)
    })
    .await
    .map_err(|e| format!("write_search_cache_meta join: {e}"))?
}

// ─── shard read/write (v5 binary) ────────────────────────────────────────────
//
// v5 변경: shard 파일은 wrapper struct 없이 `gzip(msgpack(idx.toJSON()))` raw bytes.
// IPC는 base64 string으로 통과 — Tauri JSON IPC가 Vec<u8>를 number array로 비효율
// 직렬화하는 문제 회피. base64 encode/decode 비용 ~50ms는 main thread sync이지만
// disk + gzip의 큰 비용 대비 작음.
// version은 meta 통과로 보장 (같은 vault_key 공유).

fn gunzip_to_bytes(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = GzDecoder::new(bytes);
    let mut out = Vec::new();
    decoder
        .read_to_end(&mut out)
        .map_err(|e| format!("gunzip: {e}"))?;
    Ok(out)
}

fn gzip_bytes(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(data)
        .map_err(|e| format!("gzip write: {e}"))?;
    encoder.finish().map_err(|e| format!("gzip finish: {e}"))
}

/// lazy load 시점 — 특정 shard의 msgpack 바이너리를 base64로 받음.
/// frontend가 atob → ArrayBuffer → worker(transferable) → msgpack.decode → MiniSearch.loadJS.
#[tauri::command]
pub async fn read_search_cache_shard(
    app: AppHandle,
    vault_path: String,
    shard_id: u32,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_search_cache_shard_inner(&app, &vault_path, shard_id)
    })
    .await
    .map_err(|e| format!("read_search_cache_shard join: {e}"))?
}

fn read_search_cache_shard_inner(
    app: &AppHandle,
    vault_path: &str,
    shard_id: u32,
) -> Result<Option<String>, String> {
    let path = shard_file(app, vault_path, shard_id)?;
    if !path.exists() {
        return Ok(None);
    }
    let gzipped = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[search-cache] shard{} read 실패: {}", shard_id, e);
            return Ok(None);
        }
    };
    let msgpack_bytes = match gunzip_to_bytes(&gzipped) {
        Ok(b) => b,
        Err(e) => {
            // v4 이전(JSON+gzip) 캐시 또는 손상 → cache miss로 fallback
            eprintln!("[search-cache] shard{} gunzip 실패: {}", shard_id, e);
            return Ok(None);
        }
    };
    Ok(Some(BASE64.encode(&msgpack_bytes)))
}

/// shard 저장. frontend가 worker bytes → btoa → 본 인자.
/// Rust: base64 decode → gzip → atomic write.
#[tauri::command]
pub async fn write_search_cache_shard(
    app: AppHandle,
    vault_path: String,
    shard_id: u32,
    minisearch_msgpack_b64: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let msgpack_bytes = BASE64
            .decode(&minisearch_msgpack_b64)
            .map_err(|e| format!("base64 decode: {e}"))?;
        let gzipped = gzip_bytes(&msgpack_bytes)?;
        atomic_write(&shard_file(&app, &vault_path, shard_id)?, &gzipped)
    })
    .await
    .map_err(|e| format!("write_search_cache_shard join: {e}"))?
}
