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
//! - v8: fingerprint 해시를 `DefaultHasher` → **명세된 FNV-1a 32비트 두 줄기**로 교체하고
//!   입력의 상대 경로를 `/` 정규형으로 고정. std가 `DefaultHasher`의 값 안정성을 보장하지
//!   않아 JS가 재현할 수 없었고, 그래서 MCP는 stale을 mtime 프록시로 **추정**해 수정만
//!   있는 변경을 놓쳤다(`mcp/README.md` 남은 한계). 경로 정규화는 같은 vault가 macOS와
//!   Windows에서 다른 fingerprint를 내던 것도 함께 닫는다. → `vault.rs::fingerprint_of`
//! - v9: 풀텍스트 인덱스 필드에 `title` 추가 — `["name","body"]` → `["name","title","body"]`.
//!   `name`은 파일명이라 한글 제목 질의에 아무 일도 안 했고, frontmatter `title`은 자기
//!   필드가 없어 `body` 안에서 다른 산문과 같은 취급을 받았다. 같은 183 케이스 A/B에서
//!   제목 2어절 질의 R@1 **67.2% → 86.9%**. 인덱스 토큰 공간이 바뀌므로 낡은 샤드는 못 쓴다.
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
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::hash::{fnv1a32, FNV32_OFFSET};
use crate::uipath::to_ui;
use crate::vault::{FileStat, LinkInfo};

pub const CACHE_VERSION: u32 = 9;

/// 메타 파일 schema — `*.meta.json.gz`에 직렬화.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchCacheMeta {
    pub version: u32,
    pub fingerprint: String,
    pub link_infos: Vec<LinkInfo>,
    pub shard_count: u32,
}

/// 파일 stat 스냅샷 schema — `*.stats.json.gz`에 직렬화.
///
/// **기동 델타 재조정의 근거**다. meta의 fingerprint는 "vault가 바뀌었다"만 말하고
/// 무엇이 바뀌었는지는 말하지 않아, 노트 1개 변경에도 전량 재빌드였다.
///
/// ⚠️ **meta와 별도 파일인 이유는 hit 경로의 바이트다.** meta는 매 기동 읽히는데
/// 19,000건 stat 목록(gz ~300 KB)을 거기 얹으면 vault가 안 바뀐 기동까지 그 비용을
/// 낸다. 이 파일은 **fingerprint가 어긋났을 때만** 읽는다.
///
/// ⚠️ 없어도 정상이다 — 이 필드가 생기기 전에 저장된 캐시는 stats가 없고, 그때는
/// 예전과 똑같이 풀 빌드로 떨어진 뒤 저장 단계에서 파일이 생긴다. 그래서
/// `CACHE_VERSION`을 올리지 않는다(올리면 기존 캐시가 전부 한 번 죽는다).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchCacheStats {
    pub version: u32,
    /// 이 스냅샷의 vault fingerprint. meta의 것과 불일치하면 쓰지 않는다 — shard와 같은
    /// 규율이다. 어긋난 stats로 델타를 내면 **바뀐 파일을 안 바뀐 것으로 판정**한다.
    pub fingerprint: String,
    pub files: Vec<FileStat>,
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

pub(crate) fn cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    // dev/릴리즈 분기는 `paths`가 단일 진실. 예전엔 여기서 `app_data_dir()`을 직접 불러
    // 두 빌드가 같은 캐시를 번갈아 덮어썼다(19,000노트 재인덱싱 반복).
    let dir = crate::paths::app_data_root(app)?.join("search-cache");
    fs::create_dir_all(&dir).map_err(|e| format!("search-cache mkdir: {e}"))?;
    Ok(dir)
}

/// 해시에 먹일 **정규형 경로**.
///
/// ## ⚠️ 정규화하지 않으면 같은 vault가 캐시를 둘 갖는다
///
/// 예전엔 호출부가 준 문자열을 그대로 해싱했다. 그러면 같은 vault도 **어떻게 적었느냐에
/// 따라** 키가 달라진다 — `C:\Projects\x` 와 `C:/Projects/x`, 후행 슬래시 유무,
/// 심링크를 거친 경로가 전부 다른 캐시를 만든다. 증상은 "왜 또 전체 재인덱싱이지"이고,
/// 옛 파일은 아무도 안 읽는 고아로 남는다.
///
/// 실측으로 확인했다: Windows에서 앱이 만든 캐시 이름이 역슬래시 형태의 해시였고,
/// 같은 vault를 `/` 형태로 적으면 다른 이름이 나왔다.
///
/// canonicalize가 실패하면(vault가 지워졌거나 권한) 있는 그대로 정규화만 한다 — 그 경우
/// 캐시를 못 찾는 건 어차피 정상이다.
fn normalized_vault_path(vault_path: &str) -> String {
    let p = std::path::Path::new(vault_path);
    let canon = p
        .canonicalize()
        .map(|c| to_ui(&c))
        .unwrap_or_else(|_| to_ui(p));
    // 후행 슬래시 하나로 키가 갈리지 않게 한다.
    canon.trim_end_matches('/').to_string()
}

/// 캐시 파일 이름의 접두 — vault 경로의 해시.
///
/// ## ⚠️ 이 값이 바뀌면 캐시를 통째로 못 찾는다
///
/// 파일 **이름**이라, 값이 달라지는 순간 앱은 "캐시가 없다"고 판단해 전체 재빌드로
/// 가고 옛 파일은 아무도 안 읽는 고아가 된다. 실패가 요란하지 않아 알아채기도 어렵다.
///
/// 예전엔 `DefaultHasher`였는데 std가 **값 안정성을 보장하지 않는다.** 컴파일러 판이
/// 바뀌면 그대로 위 상황이다. `crate::hash`의 명세된 FNV-1a로 옮겼다.
///
/// 두 줄기를 쓰는 이유는 폭이다. 32비트 하나면 서로 다른 두 vault가 **같은 캐시 파일을
/// 공유**할 확률이 남는데, 그건 성능이 아니라 **정확성** 문제다(한쪽이 남의 인덱스를
/// 읽는다). 두 번째 줄기는 바이트를 **뒤에서부터** 먹여 첫 줄기와 독립적으로 만든다.
pub(crate) fn vault_key(vault_path: &str) -> String {
    hash_key(&normalized_vault_path(vault_path))
}

fn hash_key(s: &str) -> String {
    let bytes = s.as_bytes();
    let a = fnv1a32(FNV32_OFFSET, bytes);
    let reversed: Vec<u8> = bytes.iter().rev().copied().collect();
    let b = fnv1a32(FNV32_OFFSET, &reversed);
    format!("{a:08x}{b:08x}")
}

/// **옛** 키들 — 이주에만 쓴다. 새 이름으로 못 찾았을 때 순서대로 시도한다.
///
/// 두 세대가 있다:
/// 1. `DefaultHasher` 시절(v1.15.0 이전)
/// 2. FNV지만 **정규화하지 않은 원문**을 해싱하던 시절(v1.16.0)
///
/// 2번이 필요한 이유 — 같은 vault라도 앱이 받은 문자열(Windows 다이얼로그의 역슬래시
/// 경로)로 이름이 지어져 있다. 정규화로 바꾸면 그 파일들이 그대로 고아가 된다.
fn legacy_vault_keys(vault_path: &str) -> Vec<String> {
    vec![legacy_default_hasher_key(vault_path), hash_key(vault_path)]
}

/// 세대 1 — `DefaultHasher`.
///
/// ⚠️ 이 함수가 옛 파일을 쓴 바이너리와 **같은 값을 낸다는 보장은 없다**(그게 바로
/// `vault_key`를 바꾼 이유다). 다만 실제로 std가 이 해시를 바꾼 적은 없어 대부분
/// 맞아떨어지고, **안 맞아도 손해가 없다** — 못 찾으면 예전과 똑같이 전체 재빌드다.
///
/// 이주가 충분히 퍼졌다고 판단되면 이 함수와 호출부를 지운다.
fn legacy_default_hasher_key(vault_path: &str) -> String {
    let mut h = DefaultHasher::new();
    vault_path.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// 옛 이름으로 남아 있는 캐시 파일을 정리한다 — **옮기거나(rename) 지운다.**
///
/// ## 왜 지우는 갈래가 있나
///
/// 이주는 원래 "새 이름이 없을 때만" 돌았다. 그런데 새 이름 파일이 **이미 있는** 경우가
/// 실제로 생긴다 — `lapis index`(CLI)가 앱보다 먼저 캐시를 쓰면 그렇다. 그때 예전 코드는
/// 아무것도 하지 않았고, 옛 파일은 **아무도 안 읽는 고아로 영영 남았다.** 그게 바로
/// [#214]가 없애려던 상태라, 실측에서 그대로 재현되는 걸 보고 고쳤다.
///
/// ⚠️ **덮어쓰지 않고 새 쪽이 낡았을 때만 옮긴다.** 무조건 rename 하면 CLI가 방금 만든
/// 최신 인덱스를 옛 스냅샷으로 덮어쓴다. 그건 "왜 또 전체 재인덱싱이지"로 이어진다
/// (fingerprint가 어긋나 읽는 쪽이 거부한다 — 안전한 실패지만 낭비다).
///
/// ⚠️ 판정은 **meta 파일 하나로** 하고 그 결정을 같은 키의 모든 파일에 적용한다. 파일별로
/// 따로 재면 meta는 새 것, shard는 옛 것처럼 **스냅샷이 찢어진다.**
///
/// 지우는 게 위험하지 않은 이유 — 이건 캐시다. 잘못 지워도 다음 기동에 다시 만든다.
///
/// 반환값은 **옮긴** 파일 수(지운 것은 세지 않는다). 0이면 새 이름이 안 생겼다는 뜻이라
/// 호출부가 "이주로 뭔가 생겼나"를 그대로 판정할 수 있다.
///
/// [#214]: https://github.com/eren0315/lapis/pull/214
fn migrate_legacy_cache_files(dir: &PathBuf, vault_path: &str) -> usize {
    let new = vault_key(vault_path);
    let olds: Vec<String> = legacy_vault_keys(vault_path)
        .into_iter()
        .filter(|k| *k != new)
        .collect();
    if olds.is_empty() {
        return 0;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };

    // ⚠️ 판정을 **루프 전에** 끝낸다. 안에서 재면 첫 파일(meta)을 옮긴 직후 새 이름 meta가
    // 생기고, 그러면 남은 파일들이 "새 세대가 이미 있다"로 판정돼 **지워진다.** 테스트가
    // 잡았다 — 4개를 옮겨야 하는데 1개만 옮기고 3개를 날렸다.
    let discard: Vec<bool> = olds
        .iter()
        .map(|old| new_generation_wins(dir, old, &new))
        .collect();

    let mut moved = 0;
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some((idx, rest)) = olds
            .iter()
            .enumerate()
            .find_map(|(i, o)| name.strip_prefix(o.as_str()).map(|r| (i, r)))
        else {
            continue;
        };
        // `{key}.meta.json.gz` · `{key}.stats.json.gz` · `{key}.shard{n}.json.gz`
        if !rest.starts_with('.') {
            continue;
        }
        if discard[idx] {
            match fs::remove_file(entry.path()) {
                Ok(()) => removed += 1,
                Err(e) => eprintln!("[search-cache] 옛 캐시 제거 실패 {name}: {e}"),
            }
            continue;
        }
        match fs::rename(entry.path(), dir.join(format!("{new}{rest}"))) {
            Ok(()) => moved += 1,
            Err(e) => eprintln!("[search-cache] 이주 실패 {name}: {e}"),
        }
    }
    if moved > 0 {
        eprintln!("[search-cache] 옛 이름 캐시 {moved}개를 새 키로 옮겼다");
    }
    if removed > 0 {
        eprintln!("[search-cache] 새 이름 캐시가 이미 최신 — 옛 파일 {removed}개 제거");
    }
    moved
}

/// 새 이름 쪽을 남길지 판정한다 — **meta 파일의 mtime 하나로** 정한다.
///
/// 새 이름 meta가 없으면 `false`(= 옮긴다). 있으면 옛 것보다 오래됐을 때만 옮기고,
/// 그렇지 않으면 새 것을 남기고 옛 것을 지운다.
///
/// mtime을 못 읽는 경우는 **보수적으로 옮기지 않는다** — 지우는 쪽이 되돌릴 수 없으니,
/// 모를 때는 아무것도 잃지 않는 선택을 한다.
fn new_generation_wins(dir: &Path, old_key: &str, new_key: &str) -> bool {
    let meta_of = |key: &str| {
        fs::metadata(dir.join(format!("{key}.meta.json.gz")))
            .and_then(|m| m.modified())
            .ok()
    };
    match (meta_of(new_key), meta_of(old_key)) {
        (Some(new_t), Some(old_t)) => new_t >= old_t,
        // 새 meta가 없다 → 옛 것이 유일한 스냅샷이다. 옮긴다.
        (None, _) => false,
        // 옛 meta가 없는데 옛 shard만 남아 있다 — 찢어진 잔재다. 새 것을 남긴다.
        (Some(_), None) => true,
    }
}

fn meta_file(app: &AppHandle, vault_path: &str) -> Result<PathBuf, String> {
    Ok(cache_root(app)?.join(format!("{}.meta.json.gz", vault_key(vault_path))))
}

fn stats_file(app: &AppHandle, vault_path: &str) -> Result<PathBuf, String> {
    Ok(cache_root(app)?.join(format!("{}.stats.json.gz", vault_key(vault_path))))
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
    // 옛 이름 파일은 **새 이름이 있든 없든** 정리한다. 여기가 그 지점인 이유: meta는
    // 캐시를 읽는 첫 관문이라, 여기서 손대면 stats·shard도 같은 호출 안에서 함께 정리된다.
    //
    // ⚠️ 예전엔 `!path.exists()` 안에서만 불렀다. 그러면 새 이름이 이미 있을 때(CLI가 앱보다
    // 먼저 인덱싱한 경우) 옛 파일이 **아무도 안 읽는 고아로 영영 남는다.** 실측으로 봤다.
    let dir = cache_root(app)?;
    migrate_legacy_cache_files(&dir, vault_path);
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
        write_meta_inner(&app, &vault_path, fingerprint, link_infos, shard_count)
    })
    .await
    .map_err(|e| format!("write_search_cache_meta join: {e}"))?
}

/// meta 저장의 **실제 구현**. 커맨드와 헤드리스 인덱싱(`headless.rs`)이 함께 쓴다.
///
/// ⚠️ 두 경로가 각자 쓰기를 구현하면 한쪽만 고쳐지는 날이 온다 — `CACHE_VERSION`이
/// 앱과 MCP에서 갈렸던 고장과 같은 부류다(#209). 구현은 여기 하나뿐이다.
pub(crate) fn write_meta_inner(
    app: &AppHandle,
    vault_path: &str,
    fingerprint: String,
    link_infos: Vec<LinkInfo>,
    shard_count: u32,
) -> Result<(), String> {
    let meta = SearchCacheMeta {
        version: CACHE_VERSION,
        fingerprint,
        link_infos,
        shard_count,
    };
    let json = serde_json::to_string(&meta).map_err(|e| format!("meta serialize: {e}"))?;
    let bytes = gzip_string(&json)?;
    atomic_write(&meta_file(app, vault_path)?, &bytes)?;
    // meta가 커밋 지점이니 청소도 여기서. 생산자와 청소부를 떼어놓으면 또 어긋난다.
    sweep_stale(app, vault_path, shard_count);
    Ok(())
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
pub(crate) const MAX_SHARDS: u32 = 16;

// ─── stats read/write (기동 델타) ────────────────────────────────────────────

/// fingerprint가 어긋났을 때만 호출 — 이전 스냅샷의 파일 stat 목록.
///
/// `expect_fingerprint`(= meta의 것)와 다르면 `None`. shard와 같은 규율이다: 어긋난
/// 스냅샷으로 델타를 계산하면 **바뀐 파일을 안 바뀐 것으로 판정**해서, 검색이 낡은
/// 본문을 조용히 계속 낸다. 그건 캐시 미스보다 나쁘다.
#[tauri::command]
pub async fn read_search_cache_stats(
    app: AppHandle,
    vault_path: String,
    expect_fingerprint: String,
) -> Result<Option<Vec<FileStat>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_search_cache_stats_inner(&app, &vault_path, &expect_fingerprint)
    })
    .await
    .map_err(|e| format!("read_search_cache_stats join: {e}"))?
}

fn read_search_cache_stats_inner(
    app: &AppHandle,
    vault_path: &str,
    expect_fingerprint: &str,
) -> Result<Option<Vec<FileStat>>, String> {
    let path = stats_file(app, vault_path)?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("[search-cache] stats read 실패: {e}");
            return Ok(None);
        }
    };
    let json = match gunzip_to_string(&bytes) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[search-cache] stats gunzip 실패: {e}");
            return Ok(None);
        }
    };
    let stats: SearchCacheStats = match serde_json::from_str(&json) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[search-cache] stats parse 실패: {e}");
            return Ok(None);
        }
    };
    match stats_reject_reason(&stats, expect_fingerprint) {
        Some(reason) => {
            eprintln!("[search-cache] stats 거부 — {}", reason);
            Ok(None)
        }
        None => Ok(Some(stats.files)),
    }
}

/// stats를 거부할 이유. `None`이면 사용 가능. `shard_reject_reason`과 같은 이유로
/// `AppHandle` 없이 떼어냈다 — 판정에 테스트가 붙는 지점이다.
fn stats_reject_reason(stats: &SearchCacheStats, want_fingerprint: &str) -> Option<String> {
    if stats.version != CACHE_VERSION {
        return Some(format!("version {} ≠ {}", stats.version, CACHE_VERSION));
    }
    if stats.fingerprint != want_fingerprint {
        return Some(format!(
            "fingerprint {} ≠ meta {}",
            stats.fingerprint, want_fingerprint
        ));
    }
    None
}

/// stats 저장 — **meta보다 먼저** 쓴다. meta가 커밋 지점이라 중간에 죽으면 옛 meta가
/// 남고, 옛 meta의 fingerprint는 새로 쓴 stats와 어긋나 위 판정이 거부한다(= 풀 빌드).
#[tauri::command]
pub async fn write_search_cache_stats(
    app: AppHandle,
    vault_path: String,
    fingerprint: String,
    files: Vec<FileStat>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        write_stats_inner(&app, &vault_path, fingerprint, files)
    })
    .await
    .map_err(|e| format!("write_search_cache_stats join: {e}"))?
}

/// stats 저장의 실제 구현. `write_meta_inner`와 같은 이유로 하나뿐이다.
pub(crate) fn write_stats_inner(
    app: &AppHandle,
    vault_path: &str,
    fingerprint: String,
    files: Vec<FileStat>,
) -> Result<(), String> {
    let stats = SearchCacheStats {
        version: CACHE_VERSION,
        fingerprint,
        files,
    };
    let json = serde_json::to_string(&stats).map_err(|e| format!("stats serialize: {e}"))?;
    let bytes = gzip_string(&json)?;
    atomic_write(&stats_file(app, vault_path)?, &bytes)
}

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
        write_shard_inner(&app, &vault_path, shard_id, fingerprint, minisearch_json)
    })
    .await
    .map_err(|e| format!("write_search_cache_shard join: {e}"))?
}

/// shard 저장의 실제 구현. `write_meta_inner`와 같은 이유로 하나뿐이다.
pub(crate) fn write_shard_inner(
    app: &AppHandle,
    vault_path: &str,
    shard_id: u32,
    fingerprint: String,
    minisearch_json: String,
) -> Result<(), String> {
    let shard = SearchCacheShard {
        version: CACHE_VERSION,
        shard_id,
        fingerprint,
        minisearch_json,
    };
    let json = serde_json::to_string(&shard).map_err(|e| format!("shard serialize: {e}"))?;
    let bytes = gzip_string(&json)?;
    atomic_write(&shard_file(app, vault_path, shard_id)?, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stats(version: u32, fingerprint: &str) -> SearchCacheStats {
        SearchCacheStats {
            version,
            fingerprint: fingerprint.to_string(),
            files: vec![],
        }
    }

    #[test]
    fn accepts_matching_stats() {
        assert_eq!(
            stats_reject_reason(&stats(CACHE_VERSION, "abc"), "abc"),
            None
        );
    }

    #[test]
    fn rejects_stats_with_stale_fingerprint() {
        // 어긋난 스냅샷으로 델타를 내면 **바뀐 파일을 안 바뀐 것으로 판정**한다.
        // shard skew보다 나쁘다 — 검색이 낡은 본문을 조용히 계속 낸다.
        let reason =
            stats_reject_reason(&stats(CACHE_VERSION, "old"), "new").expect("거부해야 한다");
        assert!(reason.contains("fingerprint"), "reason={reason}");
    }

    #[test]
    fn rejects_stats_with_old_version() {
        let reason =
            stats_reject_reason(&stats(CACHE_VERSION - 1, "abc"), "abc").expect("거부해야 한다");
        assert!(reason.contains("version"), "reason={reason}");
    }

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

    // ─── vault_key · 이주 ─────────────────────────────────────────────────

    fn tmp_dir(tag: &str) -> PathBuf {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let mut dir = std::env::temp_dir();
        dir.push(format!(
            "lapis-cachekey-{tag}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn vault_key는_결정론적이고_16자리다() {
        let k = vault_key("/Users/x/vault");
        assert_eq!(k.len(), 16);
        assert!(k.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(k, vault_key("/Users/x/vault"));
    }

    #[test]
    fn 서로_다른_vault는_다른_키다() {
        assert_ne!(vault_key("/a/vault"), vault_key("/b/vault"));
        // 뒤집은 줄기가 있어 회문형 차이도 갈린다.
        assert_ne!(vault_key("/ab"), vault_key("/ba"));
    }

    /// 이주가 의미를 가지려면 두 키가 달라야 한다. 같아지면 이주 코드가 죽은 코드다.
    #[test]
    fn 새_키는_옛_키와_다르다() {
        assert_ne!(
            vault_key("/Users/x/vault"),
            legacy_default_hasher_key("/Users/x/vault")
        );
    }

    #[test]
    fn 이주는_meta_stats_shard를_모두_옮긴다() {
        let dir = tmp_dir("migrate");
        let vault = "/Users/x/vault";
        let old = legacy_default_hasher_key(vault);
        let new = vault_key(vault);

        for suffix in [
            ".meta.json.gz",
            ".stats.json.gz",
            ".shard0.json.gz",
            ".shard3.json.gz",
        ] {
            fs::write(dir.join(format!("{old}{suffix}")), b"x").unwrap();
        }

        let moved = migrate_legacy_cache_files(&dir, vault);
        assert_eq!(moved, 4);

        for suffix in [
            ".meta.json.gz",
            ".stats.json.gz",
            ".shard0.json.gz",
            ".shard3.json.gz",
        ] {
            assert!(
                dir.join(format!("{new}{suffix}")).exists(),
                "새 이름 없음: {suffix}"
            );
            assert!(
                !dir.join(format!("{old}{suffix}")).exists(),
                "옛 이름 남음: {suffix}"
            );
        }
        fs::remove_dir_all(&dir).ok();
    }

    /// 복사가 아니라 rename이어야 한다 — 남겨두면 정리 경로 없는 고아가 된다.
    #[test]
    fn 이주는_복사가_아니라_이동이다() {
        let dir = tmp_dir("move-not-copy");
        let vault = "/Users/x/vault";
        fs::write(
            dir.join(format!("{}.meta.json.gz", legacy_default_hasher_key(vault))),
            b"x",
        )
        .unwrap();

        migrate_legacy_cache_files(&dir, vault);
        let left = fs::read_dir(&dir).unwrap().count();
        assert_eq!(left, 1, "파일이 늘었다면 복사된 것이다");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn 다른_vault의_캐시는_건드리지_않는다() {
        let dir = tmp_dir("other-vault");
        let mine = "/Users/x/vault";
        let other_legacy = legacy_default_hasher_key("/Users/x/다른vault");
        fs::write(dir.join(format!("{other_legacy}.meta.json.gz")), b"x").unwrap();
        fs::write(dir.join("lapis-settings.json"), b"{}").unwrap();

        assert_eq!(migrate_legacy_cache_files(&dir, mine), 0);
        assert!(dir.join(format!("{other_legacy}.meta.json.gz")).exists());
        assert!(dir.join("lapis-settings.json").exists());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn 옮길_게_없으면_0이다() {
        let dir = tmp_dir("nothing");
        assert_eq!(migrate_legacy_cache_files(&dir, "/Users/x/vault"), 0);
        fs::remove_dir_all(&dir).ok();
    }

    /// 접두가 우연히 겹치는 이름을 잡아채면 안 된다 — 구분자 `.`을 요구한다.
    #[test]
    fn 접두만_같은_이름은_옮기지_않는다() {
        let dir = tmp_dir("prefix");
        let vault = "/Users/x/vault";
        let old = legacy_default_hasher_key(vault);
        fs::write(dir.join(format!("{old}extra.meta.json.gz")), b"x").unwrap();

        assert_eq!(migrate_legacy_cache_files(&dir, vault), 0);
        assert!(dir.join(format!("{old}extra.meta.json.gz")).exists());
        fs::remove_dir_all(&dir).ok();
    }

    // ─── 경로 정규화 ─────────────────────────────────────────────────────

    /// 같은 vault를 다르게 적어도 같은 캐시를 봐야 한다. 아니면 철자마다 캐시가 생기고
    /// 매번 전체 재빌드다.
    #[test]
    fn 구분자가_달라도_같은_키다() {
        let dir = tmp_dir("sep");
        let a = vault_key(&dir.to_string_lossy());
        let b = vault_key(&to_ui(&dir));
        assert_eq!(a, b);
        // ⚠️ 위 두 줄은 Windows에서만 실제로 다른 문자열이다. 다른 플랫폼에서도 뭔가를
        // 고정하도록 점 세그먼트를 함께 본다 — 어디서나 같은 곳을 가리키는 다른 철자다.
        assert_eq!(a, vault_key(&format!("{}/.", to_ui(&dir))));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn 후행_슬래시가_있어도_같은_키다() {
        let dir = tmp_dir("slash");
        let base = to_ui(&dir);
        assert_eq!(vault_key(&base), vault_key(&format!("{base}/")));
        fs::remove_dir_all(&dir).ok();
    }

    /// 존재하지 않는 경로도 죽지 않는다 — canonicalize 실패 시 있는 그대로 정규화한다.
    #[test]
    fn 없는_경로도_키를_낸다() {
        let k = vault_key("/definitely/not/here");
        assert_eq!(k.len(), 16);
    }

    /// 정규화 이전 세대(원문 해싱)로 지어진 파일도 이주 대상이다.
    ///
    /// ⚠️ 철자 변형으로 **후행 슬래시**를 쓴다. 구분자 뒤집기(`/` → `\`)는 Windows에서만
    /// 철자 변형이다 — macOS·Linux에서 `\`는 그냥 평범한 파일명 문자라 `to_ui`가 건드리지
    /// 않고, 그러면 두 세대 키가 같아져 테스트가 조용히 무의미해진다. 실제로 CI의 macOS에서
    /// 아래 `assert_ne!`가 그걸 잡았다. 후행 슬래시는 어느 플랫폼에서나 철자 변형이다.
    #[test]
    fn 정규화_이전_이름도_이주한다() {
        let dir = tmp_dir("gen2");
        let raw = format!("{}/", to_ui(&dir));
        let old = hash_key(&raw);
        let new = vault_key(&dir.to_string_lossy());
        assert_ne!(old, new, "두 세대가 같으면 이 테스트가 무의미하다");

        fs::write(dir.join(format!("{old}.meta.json.gz")), b"x").unwrap();
        assert_eq!(migrate_legacy_cache_files(&dir, &raw), 1);
        assert!(dir.join(format!("{new}.meta.json.gz")).exists());
        fs::remove_dir_all(&dir).ok();
    }

    /// 두 세대 모두 없으면 아무 일도 없다.
    #[test]
    fn 이주할_세대가_없으면_0() {
        let dir = tmp_dir("gen0");
        assert_eq!(migrate_legacy_cache_files(&dir, &dir.to_string_lossy()), 0);
        fs::remove_dir_all(&dir).ok();
    }

    // ─── 고아 정리 ────────────────────────────────────────────────────────

    /// 새 이름 캐시가 이미 최신이면 옛 파일은 **지운다.** 남겨두면 아무도 안 읽는
    /// 고아가 되는데, 그게 바로 #214가 없애려던 상태다.
    ///
    /// 실제로 생기는 경로: `lapis index`(CLI)가 앱보다 먼저 캐시를 쓴 뒤 앱을 켜는 것.
    #[test]
    fn 새_이름이_최신이면_옛_파일을_지운다() {
        let dir = tmp_dir("orphan");
        let vault = "/Users/x/vault";
        let old = legacy_default_hasher_key(vault);
        let new = vault_key(vault);
        assert_ne!(old, new, "두 키가 같으면 이 테스트가 무의미하다");

        // 옛 파일을 먼저 만들고, 새 파일을 나중에 만든다 → 새 쪽이 최신이다.
        for k in [&old, &new] {
            for suffix in [".meta.json.gz", ".stats.json.gz", ".shard0.json.gz"] {
                fs::write(dir.join(format!("{k}{suffix}")), b"x").unwrap();
            }
            // mtime 해상도가 거친 파일시스템에서도 순서가 서게 한다.
            touch_newer(&dir.join(format!("{k}.meta.json.gz")), k == &new);
        }

        // 옮긴 게 없다(0) — 새 이름이 이미 있으니 이주할 것은 없다.
        assert_eq!(migrate_legacy_cache_files(&dir, vault), 0);

        for suffix in [".meta.json.gz", ".stats.json.gz", ".shard0.json.gz"] {
            assert!(
                !dir.join(format!("{old}{suffix}")).exists(),
                "옛 파일이 남았다: {suffix}"
            );
            assert!(
                dir.join(format!("{new}{suffix}")).exists(),
                "새 파일이 사라졌다: {suffix}"
            );
        }
        fs::remove_dir_all(&dir).ok();
    }

    /// ⚠️ 판정을 파일마다 따로 하면 **meta를 옮긴 직후** 남은 파일들이 "새 세대가 이미
    /// 있다"로 판정돼 지워진다. 실제로 그렇게 짰다가 이 테스트가 잡았다(4개 중 3개를
    /// 날렸다). 그래서 판정은 키별로 루프 밖에서 한 번만 한다.
    #[test]
    fn 옮기는_중_판정이_뒤집히지_않는다() {
        let dir = tmp_dir("flip");
        let vault = "/Users/x/vault";
        let old = legacy_default_hasher_key(vault);
        let new = vault_key(vault);

        // 새 이름 파일은 **하나도 없다.** 전부 옮겨져야 한다.
        let suffixes = [
            ".meta.json.gz",
            ".stats.json.gz",
            ".shard0.json.gz",
            ".shard1.json.gz",
        ];
        for suffix in suffixes {
            fs::write(dir.join(format!("{old}{suffix}")), b"x").unwrap();
        }

        assert_eq!(migrate_legacy_cache_files(&dir, vault), suffixes.len());
        for suffix in suffixes {
            assert!(
                dir.join(format!("{new}{suffix}")).exists(),
                "안 옮겨졌다: {suffix}"
            );
        }
        fs::remove_dir_all(&dir).ok();
    }

    /// 새 이름 meta가 **더 낡았으면** 옛 것을 살린다 — 최신 스냅샷을 잃지 않는다.
    #[test]
    fn 새_이름이_낡았으면_옛_것으로_덮는다() {
        let dir = tmp_dir("newer-old");
        let vault = "/Users/x/vault";
        let old = legacy_default_hasher_key(vault);
        let new = vault_key(vault);

        fs::write(dir.join(format!("{new}.meta.json.gz")), b"stale").unwrap();
        fs::write(dir.join(format!("{old}.meta.json.gz")), b"fresh").unwrap();
        // ⚠️ **둘 다** 고정한다. 한쪽만 옛 시각으로 밀면 다른 쪽은 "지금"이라 늘 그쪽이
        // 최신이 된다 — 처음 그렇게 짜서 이 테스트가 반대 결론을 냈다.
        touch_newer(&dir.join(format!("{new}.meta.json.gz")), false);
        touch_newer(&dir.join(format!("{old}.meta.json.gz")), true);

        assert_eq!(migrate_legacy_cache_files(&dir, vault), 1);
        let body = fs::read(dir.join(format!("{new}.meta.json.gz"))).unwrap();
        assert_eq!(body, b"fresh");
        fs::remove_dir_all(&dir).ok();
    }

    /// 옛 meta 없이 shard만 남은 잔재는 지운다 — 혼자서는 아무 쓸모가 없다.
    #[test]
    fn 찢어진_옛_잔재는_지운다() {
        let dir = tmp_dir("torn");
        let vault = "/Users/x/vault";
        let old = legacy_default_hasher_key(vault);
        let new = vault_key(vault);

        fs::write(dir.join(format!("{new}.meta.json.gz")), b"ok").unwrap();
        fs::write(dir.join(format!("{old}.shard0.json.gz")), b"junk").unwrap();

        assert_eq!(migrate_legacy_cache_files(&dir, vault), 0);
        assert!(!dir.join(format!("{old}.shard0.json.gz")).exists());
        fs::remove_dir_all(&dir).ok();
    }

    /// mtime을 벌린다. 거친 해상도의 파일시스템에서도 순서가 서야 판정이 흔들리지 않는다.
    fn touch_newer(path: &std::path::Path, newer: bool) {
        let base =
            std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
        let t = if newer {
            base + std::time::Duration::from_secs(60)
        } else {
            base
        };
        let f = fs::File::options().write(true).open(path).unwrap();
        f.set_modified(t).unwrap();
    }
}
