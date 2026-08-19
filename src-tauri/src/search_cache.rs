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
//! - v5: LinkInfo에 generic `props`(모든 frontmatter 키) 추가 — Phase A 지식 그래프
//! - v6: 풀텍스트 토크나이저를 한글 bigram 하이브리드로 변경(koTokenize) — 인덱스 토큰 공간 변경
//! - v7: shard에 `fingerprint` 추가 — meta와의 skew를 소비 측에서 검출 가능하게. 아래 참조.
//!
//! ## meta ↔ shard skew (v7에서 닫음)
//!
//! v6까지 shard는 자기가 **어느 스냅샷의 shard인지** 몰랐다. `version`과 `shard_id`만
//! 들었고, `shard_id`는 역직렬화하고도 **한 번도 대조하지 않았다**. 그래서:
//!
//! - meta를 먼저 쓰고 shard 8개를 순차 기록하던 중 앱이 죽으면 "새 fingerprint + 옛
//!   shard"가 디스크에 영속된다 → 다음 기동에서 HIT 오판 → **풀텍스트가 조용히 낡는다**.
//!   gzip 0.22s × 8 + 58MB IPC라 그 창이 μs가 아니다.
//! - 구조 데이터(meta)와 풀텍스트(shard)의 저장 조건이 갈리면(풀텍스트 실패 시 meta만
//!   저장) 같은 skew가 사고가 아니라 **정상 경로에서** 생긴다.
//!
//! v7의 처방 두 개:
//! 1. **shard가 fingerprint를 들고 다닌다.** 읽을 때 meta의 것과 대조해 불일치면 miss.
//! 2. **`shard_id`를 실제로 대조한다.**
//!
//! 쓰기 순서는 프론트가 책임진다 — **shard 전부 → meta 마지막**(`stores/vault.ts`).
//! meta가 커밋 지점이라, 중간에 죽으면 옛 meta가 남아 옛 shard와 짝이 맞는다.

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{Read, Write};
use std::path::PathBuf;
use tauri::AppHandle;

use crate::vault::LinkInfo;

pub const CACHE_VERSION: u32 = 7;

/// 메타 파일 schema — `*.meta.json.gz`에 직렬화.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchCacheMeta {
    pub version: u32,
    pub fingerprint: String,
    pub link_infos: Vec<LinkInfo>,
    pub shard_count: u32,
}

/// shard 파일 schema — `*.shard{i}.json.gz`에 직렬화.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchCacheShard {
    pub version: u32,
    pub shard_id: u32,
    /// 이 shard가 속한 스냅샷의 vault fingerprint. meta의 것과 불일치하면 cache miss.
    pub fingerprint: String,
    /// MiniSearch.toJSON() 결과 그대로
    pub minisearch_json: String,
}

fn cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    // dev/릴리즈 분기는 `paths`가 단일 진실. 예전엔 여기서 `app_data_dir()`을 직접 불러
    // 두 빌드가 같은 캐시를 번갈아 덮어썼다(19,000노트 재인덱싱 반복).
    let dir = crate::paths::app_data_root(app)?.join("search-cache");
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
    Ok(cache_root(app)?.join(format!(
        "{}.shard{}.json.gz",
        vault_key(vault_path),
        shard_id
    )))
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
        let shard_count = meta.shard_count;
        let json = serde_json::to_string(&meta).map_err(|e| format!("meta serialize: {e}"))?;
        let bytes = gzip_string(&json)?;
        atomic_write(&meta_file(&app, &vault_path)?, &bytes)?;
        // meta가 커밋 지점이니 청소도 여기서. 생산자와 청소부를 떼어놓으면 또 어긋난다.
        sweep_stale(&app, &vault_path, shard_count);
        Ok(())
    })
    .await
    .map_err(|e| format!("write_search_cache_meta join: {e}"))?
}

/// 이 vault의 잔재 파일 정리 — meta 커밋 직후 호출. 실패는 무시한다(캐시일 뿐이다).
///
/// 지우는 것 두 종류:
/// - **v3 단일 캐시 `{key}.json`** — 5/20부터 6.63 MB가 남아 있었다. `read_search_cache_meta`
///   주석은 "version mismatch로 cache miss"라 설명했지만 실제로는 **파일명이 달라 접근
///   자체가 안 되는** 것이라 영원히 GC되지 않았다(§10 ⑥, 주석도 함께 고쳤다).
/// - **`shard_count` 이상의 shard** — `decideShardCount`가 줄거나 풀텍스트 미준비로
///   `shard_count: 0`을 커밋하면 옛 shard가 고아로 남는다. 지금은 fingerprint 대조에
///   걸려 읽히지 않지만, 디스크만 차지하는 파일을 남길 이유가 없다.
///
/// ⚠️ **다른 vault의 캐시는 건드리지 않는다.** `vault_key`는 역변환이 불가능해서
/// "쓰이지 않는 키"를 판정할 방법이 없다. 남의 키를 추측으로 지우면 남의 캐시를 날린다.
fn sweep_stale(app: &AppHandle, vault_path: &str, shard_count: u32) {
    let Ok(root) = cache_root(app) else { return };
    let key = vault_key(vault_path);

    let legacy = root.join(format!("{}.json", key));
    if legacy.exists() {
        match fs::remove_file(&legacy) {
            Ok(()) => eprintln!("[search-cache] v3 잔재 제거: {}", legacy.display()),
            Err(e) => eprintln!("[search-cache] v3 잔재 제거 실패: {e}"),
        }
    }

    for i in shard_count..MAX_SHARDS {
        let p = root.join(format!("{}.shard{}.json.gz", key, i));
        if p.exists() {
            match fs::remove_file(&p) {
                Ok(()) => eprintln!("[search-cache] 고아 shard{} 제거", i),
                Err(e) => eprintln!("[search-cache] 고아 shard{} 제거 실패: {e}", i),
            }
        }
    }
}

/// 프론트의 `MAX_SHARDS`(`fullTextOptions.ts`)와 일치. 고아 스윕 상한으로만 쓴다.
const MAX_SHARDS: u32 = 16;

// ─── shard read/write ───────────────────────────────────────────────────────

/// lazy load 시점 — 특정 shard의 MiniSearch JSON 문자열만. 1.8s 단위로 progressive load 가능.
#[tauri::command]
pub async fn read_search_cache_shard(
    app: AppHandle,
    vault_path: String,
    shard_id: u32,
    expect_fingerprint: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_search_cache_shard_inner(&app, &vault_path, shard_id, &expect_fingerprint)
    })
    .await
    .map_err(|e| format!("read_search_cache_shard join: {e}"))?
}

fn read_search_cache_shard_inner(
    app: &AppHandle,
    vault_path: &str,
    shard_id: u32,
    expect_fingerprint: &str,
) -> Result<Option<String>, String> {
    let path = shard_file(app, vault_path, shard_id)?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[search-cache] shard{} read 실패: {}", shard_id, e);
            return Ok(None);
        }
    };
    let json = match gunzip_to_string(&bytes) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[search-cache] shard{} gunzip 실패: {}", shard_id, e);
            return Ok(None);
        }
    };
    let shard: SearchCacheShard = match serde_json::from_str(&json) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[search-cache] shard{} parse 실패: {}", shard_id, e);
            return Ok(None);
        }
    };
    match shard_reject_reason(&shard, shard_id, expect_fingerprint) {
        Some(reason) => {
            eprintln!("[search-cache] shard{} 거부 — {}", shard_id, reason);
            Ok(None)
        }
        None => Ok(Some(shard.minisearch_json)),
    }
}

/// shard를 거부할 이유. `None`이면 사용 가능.
///
/// `AppHandle` 없이 판정만 떼어낸 순수 함수 — 이 판정이 v6까지 **없어서** 낡은 shard가
/// 조용히 읽혔다. 테스트가 붙는 지점이 여기다.
fn shard_reject_reason(
    shard: &SearchCacheShard,
    want_id: u32,
    want_fingerprint: &str,
) -> Option<String> {
    if shard.version != CACHE_VERSION {
        return Some(format!("version {} ≠ {}", shard.version, CACHE_VERSION));
    }
    // 파일명과 내용이 어긋나면 남의 shard다. v6까지 역직렬화만 하고 대조하지 않았다.
    if shard.shard_id != want_id {
        return Some(format!("shard_id {} ≠ {}", shard.shard_id, want_id));
    }
    // meta와 다른 스냅샷의 shard면 풀텍스트가 조용히 낡는다.
    if shard.fingerprint != want_fingerprint {
        return Some(format!(
            "fingerprint {} ≠ meta {}",
            shard.fingerprint, want_fingerprint
        ));
    }
    None
}

#[tauri::command]
pub async fn write_search_cache_shard(
    app: AppHandle,
    vault_path: String,
    shard_id: u32,
    fingerprint: String,
    minisearch_json: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let shard = SearchCacheShard {
            version: CACHE_VERSION,
            shard_id,
            fingerprint,
            minisearch_json,
        };
        let json = serde_json::to_string(&shard).map_err(|e| format!("shard serialize: {e}"))?;
        let bytes = gzip_string(&json)?;
        atomic_write(&shard_file(&app, &vault_path, shard_id)?, &bytes)
    })
    .await
    .map_err(|e| format!("write_search_cache_shard join: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shard(version: u32, shard_id: u32, fingerprint: &str) -> SearchCacheShard {
        SearchCacheShard {
            version,
            shard_id,
            fingerprint: fingerprint.to_string(),
            minisearch_json: "{}".to_string(),
        }
    }

    #[test]
    fn accepts_matching_shard() {
        let s = shard(CACHE_VERSION, 3, "abc123");
        assert_eq!(shard_reject_reason(&s, 3, "abc123"), None);
    }

    #[test]
    fn rejects_stale_fingerprint() {
        // meta는 새 스냅샷인데 shard는 옛 스냅샷 — v6까지 이게 통과해서
        // "새 fingerprint + 옛 shard"로 풀텍스트가 조용히 낡았다.
        let s = shard(CACHE_VERSION, 0, "old_fp");
        let reason = shard_reject_reason(&s, 0, "new_fp").expect("거부해야 한다");
        assert!(reason.contains("fingerprint"), "reason={reason}");
    }

    #[test]
    fn rejects_shard_id_mismatch() {
        // 파일명은 shard2인데 내용은 shard5 — 남의 shard를 읽는 상황.
        let s = shard(CACHE_VERSION, 5, "abc123");
        let reason = shard_reject_reason(&s, 2, "abc123").expect("거부해야 한다");
        assert!(reason.contains("shard_id"), "reason={reason}");
    }

    #[test]
    fn rejects_old_version() {
        let s = shard(CACHE_VERSION - 1, 0, "abc123");
        let reason = shard_reject_reason(&s, 0, "abc123").expect("거부해야 한다");
        assert!(reason.contains("version"), "reason={reason}");
    }

    #[test]
    fn version_checked_before_fingerprint() {
        // 구버전 shard엔 fingerprint 필드가 없어 serde 기본값(빈 문자열)이 들어온다.
        // version을 먼저 보지 않으면 "fingerprint 불일치"로 오진해 원인 파악을 흐린다.
        let s = shard(CACHE_VERSION - 1, 9, "");
        let reason = shard_reject_reason(&s, 0, "abc123").expect("거부해야 한다");
        assert!(reason.starts_with("version"), "reason={reason}");
    }
}
