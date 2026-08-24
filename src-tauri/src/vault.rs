use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::BTreeMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Clone)]
pub struct NoteEntry {
    pub path: String,
    pub rel_path: String,
    pub name: String,
    pub is_dir: bool,
    pub children: Option<Vec<NoteEntry>>,
}

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".svelte-kit",
    "build",
    "dist",
    ".git",
];

/// `LAPIS_PERF=1`이면 perf 계측 로그를 stderr로 출력.
fn perf_enabled() -> bool {
    std::env::var("LAPIS_PERF").ok().as_deref() == Some("1")
}

#[tauri::command]
pub fn list_notes(vault_path: String) -> Result<Vec<NoteEntry>, String> {
    let root = PathBuf::from(&vault_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", vault_path));
    }
    walk_dir(&root, &root).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_note(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// .md 파일 atomic 저장.
/// 1) vault_path 하위인지 검증 (path traversal 방지)
/// 2) .md 확장자 강제
/// 3) 같은 디렉토리에 임시 파일로 쓴 후 rename (POSIX atomic)
#[tauri::command]
pub fn write_note(vault_path: String, path: String, content: String) -> Result<(), String> {
    let vault = canonicalize_vault(&vault_path)?;
    let target_canon = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| format!("target canonicalize failed: {e}"))?;
    ensure_in_vault(&target_canon, &vault)?;
    ensure_supported_extension(&target_canon)?;
    atomic_write(&target_canon, &content)
}

/// 새 노트 생성 — parent_dir(vault 상대 또는 절대) 안에 file_name(.md)로 빈/템플릿 노트.
/// 이미 같은 경로에 파일이 있으면 에러. 부모 디렉토리는 미리 존재해야 함.
#[tauri::command]
pub fn create_note(
    vault_path: String,
    parent_dir: String,
    file_name: String,
    content: String,
) -> Result<String, String> {
    let vault = canonicalize_vault(&vault_path)?;
    let parent = resolve_dir(&parent_dir, &vault)?;

    let name = if file_name.to_lowercase().ends_with(".md") {
        file_name.clone()
    } else {
        format!("{file_name}.md")
    };
    sanitize_file_name(&name)?;

    let target = parent.join(&name);
    if target.exists() {
        return Err(format!("already exists: {}", target.display()));
    }
    ensure_md_extension(&target)?;

    // 부모 자체가 vault 하위인지는 resolve_dir에서 보장. 그러나 target은 아직 존재 안 함 → 부모 기준 확인.
    if !parent.starts_with(&vault) {
        return Err("parent outside vault".to_string());
    }

    atomic_write(&target, &content)?;
    Ok(target.to_string_lossy().to_string())
}

/// 새 폴더 생성. 이미 있으면 에러.
#[tauri::command]
pub fn create_folder(
    vault_path: String,
    parent_dir: String,
    folder_name: String,
) -> Result<String, String> {
    let vault = canonicalize_vault(&vault_path)?;
    let parent = resolve_dir(&parent_dir, &vault)?;
    sanitize_file_name(&folder_name)?;
    let target = parent.join(&folder_name);
    if target.exists() {
        return Err(format!("already exists: {}", target.display()));
    }
    if !parent.starts_with(&vault) {
        return Err("parent outside vault".to_string());
    }
    fs::create_dir(&target).map_err(|e| format!("create_dir failed: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

/// 노트(또는 폴더) 휴지통 이동. .md 강제 + vault confine.
#[tauri::command]
pub fn delete_note(vault_path: String, path: String) -> Result<(), String> {
    let vault = canonicalize_vault(&vault_path)?;
    let target = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| format!("canonicalize failed: {e}"))?;
    ensure_in_vault(&target, &vault)?;
    // 파일이면 지원 확장자(.md / .mmd) 강제, 디렉토리는 OK.
    if target.is_file() {
        ensure_supported_extension(&target)?;
    }
    trash::delete(&target).map_err(|e| format!("trash failed: {e}"))
}

/// 노트 이름 변경. 같은 디렉토리 안에서. new_name은 확장자 포함 가능.
#[tauri::command]
pub fn rename_note(
    vault_path: String,
    old_path: String,
    new_name: String,
) -> Result<String, String> {
    let vault = canonicalize_vault(&vault_path)?;
    let old_canon = PathBuf::from(&old_path)
        .canonicalize()
        .map_err(|e| format!("canonicalize failed: {e}"))?;
    ensure_in_vault(&old_canon, &vault)?;

    // 새 이름에 확장자가 빠져 있고 원본이 파일이면 원본 확장자를 보존한다.
    // 예: "diagram.mmd" → rename to "flowchart" → "flowchart.mmd" (강제 .md 변환 X).
    let name = if !old_canon.is_file() {
        new_name.clone()
    } else {
        let already_has_supported_ext = new_name
            .rsplit_once('.')
            .map(|(_, ext)| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("mmd"))
            .unwrap_or(false);
        if already_has_supported_ext {
            new_name.clone()
        } else {
            let old_ext = old_canon
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_else(|| "md".to_string());
            format!("{new_name}.{old_ext}")
        }
    };
    sanitize_file_name(&name)?;

    let parent = old_canon.parent().ok_or_else(|| "no parent".to_string())?;
    let new_path = parent.join(&name);

    if new_path == old_canon {
        return Ok(new_path.to_string_lossy().to_string());
    }
    if new_path.exists() {
        return Err(format!("target already exists: {}", new_path.display()));
    }
    if old_canon.is_file() {
        ensure_supported_extension(&new_path)?;
    }

    fs::rename(&old_canon, &new_path).map_err(|e| format!("rename failed: {e}"))?;
    Ok(new_path.to_string_lossy().to_string())
}

/// 노트(또는 폴더) 이동 — 같은 vault 내 다른 폴더로.
#[tauri::command]
pub fn move_note(
    vault_path: String,
    path: String,
    new_parent_dir: String,
) -> Result<String, String> {
    let vault = canonicalize_vault(&vault_path)?;
    let source = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| format!("source canonicalize failed: {e}"))?;
    ensure_in_vault(&source, &vault)?;
    let new_parent = resolve_dir(&new_parent_dir, &vault)?;

    let file_name = source
        .file_name()
        .ok_or_else(|| "no file name".to_string())?;
    let new_path = new_parent.join(file_name);

    if new_path == source {
        return Ok(new_path.to_string_lossy().to_string());
    }
    if new_path.exists() {
        return Err(format!("target already exists: {}", new_path.display()));
    }

    fs::rename(&source, &new_path).map_err(|e| format!("move failed: {e}"))?;
    Ok(new_path.to_string_lossy().to_string())
}

/// 노트와 같은 폴더에서 같은 stem으로 시작하는 이미지 파일들을 찾는다.
/// Phase 4.4.b — `topic.md` 옆 `topic_style1.svg`, `topic_style2.png` 같은 발행물 자동 매칭.
///
/// 매칭 규칙:
/// - 같은 stem 정확 일치 (예: `topic.svg`) OR
/// - `{stem}{separator}...` 형태 — separator는 `_`, `-`, `.` 중 하나
///   (그래야 `a.md`가 `another.png`에 잘못 매칭되지 않음)
/// - 확장자 화이트리스트: svg, png, jpg, jpeg, gif, webp
#[derive(Debug, Serialize, Clone)]
pub struct AssetInfo {
    pub name: String,
    pub abs_path: String,
    pub kind: String, // 소문자 확장자
}

const ASSET_EXTS: &[&str] = &["svg", "png", "jpg", "jpeg", "gif", "webp"];

#[tauri::command]
pub fn find_assets_for_note(
    vault_path: String,
    note_path: String,
) -> Result<Vec<AssetInfo>, String> {
    let vault = canonicalize_vault(&vault_path)?;
    let note = PathBuf::from(&note_path)
        .canonicalize()
        .map_err(|e| format!("note canonicalize failed: {e}"))?;
    ensure_in_vault(&note, &vault)?;

    let parent = note.parent().ok_or_else(|| "no parent".to_string())?;
    let stem = note
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "no stem".to_string())?
        .to_string();

    let mut out: Vec<AssetInfo> = Vec::new();
    for entry in fs::read_dir(parent).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext_lower = match path.extension().and_then(|e| e.to_str()) {
            Some(e) => e.to_ascii_lowercase(),
            None => continue,
        };
        if !ASSET_EXTS.contains(&ext_lower.as_str()) {
            continue;
        }

        let Some(fstem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if !name_belongs_to(fstem, &stem) {
            continue;
        }

        let Some(fname) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        out.push(AssetInfo {
            name: fname.to_string(),
            abs_path: path.to_string_lossy().to_string(),
            kind: ext_lower,
        });
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// stem 매칭. `a.md` ↔ `another.png` 잘못 매칭을 막기 위해 stem 직후에 separator만 허용.
fn name_belongs_to(fstem: &str, stem: &str) -> bool {
    if fstem == stem {
        return true;
    }
    if !fstem.starts_with(stem) {
        return false;
    }
    matches!(
        fstem.as_bytes().get(stem.len()),
        Some(b'_') | Some(b'-') | Some(b'.')
    )
}

/// 링크 자동 갱신 전 affected 노트의 원본을 백업.
///
/// vault 안의 `<backup_dir_rel>` (예: `.lapis/link-rewrite-backup/<ISO-ts>`)에
/// 각 source 노트의 vault-relative 경로 구조를 유지하며 복사. 백업 위치는
/// `.`로 시작하는 hidden 디렉토리 트리라 `walk_dir`이 자동 제외 → vault tree에 안 보임.
///
/// 인자:
/// - `vault_path`: vault root (canonicalize됨)
/// - `source_paths`: 백업할 노트의 절대 경로 리스트
/// - `backup_dir_rel`: vault 상대 경로 (예: `.lapis/link-rewrite-backup/2026-05-18T15-40-00Z`)
///
/// 안전성:
/// - source는 vault 안 + 지원 확장자 (`.md`/`.mmd`)만
/// - backup_dir도 canonicalize 후 vault 안 확인 (`..` 등 traversal 방지)
/// - 백업 디렉토리는 미존재 시 자동 생성
///
/// 반환: 백업 디렉토리 절대 경로 문자열.
#[tauri::command]
pub fn backup_notes(
    vault_path: String,
    source_paths: Vec<String>,
    backup_dir_rel: String,
) -> Result<String, String> {
    let vault = canonicalize_vault(&vault_path)?;
    let backup_root = vault.join(&backup_dir_rel);
    fs::create_dir_all(&backup_root).map_err(|e| format!("backup dir create failed: {e}"))?;
    let backup_root_canon = backup_root
        .canonicalize()
        .map_err(|e| format!("backup dir canonicalize failed: {e}"))?;
    ensure_in_vault(&backup_root_canon, &vault)?;

    for src in &source_paths {
        let src_canon = PathBuf::from(src)
            .canonicalize()
            .map_err(|e| format!("source canonicalize failed ({src}): {e}"))?;
        ensure_in_vault(&src_canon, &vault)?;
        ensure_supported_extension(&src_canon)?;
        let rel = src_canon
            .strip_prefix(&vault)
            .map_err(|e| format!("strip_prefix failed ({src}): {e}"))?;
        let dst = backup_root_canon.join(rel);
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("backup parent create failed: {e}"))?;
        }
        fs::copy(&src_canon, &dst).map_err(|e| format!("backup copy failed ({src}): {e}"))?;
    }

    Ok(backup_root_canon.to_string_lossy().to_string())
}

/// 링크 자동 갱신 백업 디렉토리(`.lapis/link-rewrite-backup/`) 안에서
/// 최신 `max_keep`개를 제외한 오래된 백업 디렉토리를 삭제.
///
/// 백업 디렉토리 이름은 ISO timestamp (`new Date().toISOString().replace(/[:.]/g, "-")`)
/// → 알파벳 정렬 == 시간 정렬. 안전하게 sort 후 앞쪽(오래된) 제외.
///
/// 반환: 삭제된 디렉토리 개수.
///
/// 백업 root가 없으면 0 반환 (에러 X). 개별 디렉토리 삭제 실패는 stderr 로그 + 계속 진행.
#[tauri::command]
pub fn prune_link_rewrite_backups(vault_path: String, max_keep: usize) -> Result<usize, String> {
    let vault = canonicalize_vault(&vault_path)?;
    let backup_root = vault.join(".lapis/link-rewrite-backup");
    if !backup_root.is_dir() {
        return Ok(0);
    }

    let mut dirs: Vec<PathBuf> = fs::read_dir(&backup_root)
        .map_err(|e| format!("read_dir failed: {e}"))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();

    // ISO timestamp 디렉토리명 → 알파벳 정렬 == 시간 오름차순
    dirs.sort();

    if dirs.len() <= max_keep {
        return Ok(0);
    }

    let cutoff = dirs.len() - max_keep;
    let to_delete = &dirs[..cutoff];
    let mut removed = 0;
    for d in to_delete {
        // 안전 재검증: backup_root 안인지.
        if !d.starts_with(&backup_root) {
            continue;
        }
        match fs::remove_dir_all(d) {
            Ok(()) => removed += 1,
            Err(e) => eprintln!("[lapis] backup prune failed for {}: {e}", d.display()),
        }
    }
    Ok(removed)
}

// === 공통 헬퍼 ===

fn canonicalize_vault(vault_path: &str) -> Result<PathBuf, String> {
    PathBuf::from(vault_path)
        .canonicalize()
        .map_err(|e| format!("vault canonicalize failed: {e}"))
}

/// parent_dir 입력 — vault 상대 경로 또는 절대 경로 모두 허용.
fn resolve_dir(input: &str, vault: &Path) -> Result<PathBuf, String> {
    let candidate = if PathBuf::from(input).is_absolute() {
        PathBuf::from(input)
    } else {
        vault.join(input)
    };
    let canon = candidate
        .canonicalize()
        .map_err(|e| format!("dir canonicalize failed ({input}): {e}"))?;
    if !canon.is_dir() {
        return Err(format!("not a directory: {}", canon.display()));
    }
    ensure_in_vault(&canon, vault)?;
    Ok(canon)
}

fn ensure_in_vault(path: &Path, vault: &Path) -> Result<(), String> {
    if !path.starts_with(vault) {
        return Err(format!(
            "path outside vault: {} not under {}",
            path.display(),
            vault.display()
        ));
    }
    Ok(())
}

/// Lapis가 다루는 노트 확장자: `.md` (마크다운 본문) + `.mmd` (단일 mermaid 다이어그램).
/// `.mmd`는 v0.4.0부터 읽기/저장/삭제/이름변경 가능. 생성(create_note)은 여전히 `.md`만.
/// 트리(walk_dir)·fingerprint(walk_md_stats)·bundle(walk_md_files)·watcher(is_relevant_path)가
/// **모두 이 술어를 공유**해야 화면(트리)과 인덱스(검색/fingerprint)·외부변경 감시가 갈라지지 않는다.
pub(crate) fn is_supported_note_ext(ext: &std::ffi::OsStr) -> bool {
    let s = ext.to_string_lossy();
    s.eq_ignore_ascii_case("md") || s.eq_ignore_ascii_case("mmd")
}

fn ensure_supported_extension(path: &Path) -> Result<(), String> {
    if path.extension().is_none_or(|e| !is_supported_note_ext(e)) {
        return Err("only .md or .mmd files allowed".to_string());
    }
    Ok(())
}

/// create_note 전용 — 신규 생성은 항상 `.md`만 (Lapis는 .mmd 신규 생성 UI 미제공).
fn ensure_md_extension(path: &Path) -> Result<(), String> {
    if path
        .extension()
        .is_none_or(|e| !e.eq_ignore_ascii_case("md"))
    {
        return Err("only .md files allowed for create".to_string());
    }
    Ok(())
}

/// 파일/폴더 이름 검증 — 경로 구분자, ".." 등 거부.
fn sanitize_file_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("name empty".to_string());
    }
    if name.contains('/') || name.contains('\\') {
        return Err("name must not contain path separators".to_string());
    }
    if name == "." || name == ".." {
        return Err("invalid name".to_string());
    }
    Ok(())
}

/// 같은 디렉토리에 temp file 쓴 후 rename — atomic write (바이너리).
/// 부분 쓰기 방지: temp 완성 후 단일 rename. 실패 시 temp 정리.
fn atomic_write_bytes(target: &Path, content: &[u8]) -> Result<(), String> {
    let dir = target
        .parent()
        .ok_or_else(|| "no parent directory".to_string())?;
    let file_name = target
        .file_name()
        .ok_or_else(|| "no file name".to_string())?
        .to_string_lossy()
        .to_string();

    let pid = std::process::id();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let temp_path = dir.join(format!(".{file_name}.tmp.lapis-{pid}-{nanos}"));

    if let Err(e) = fs::write(&temp_path, content) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("temp write failed: {e}"));
    }
    if let Err(e) = fs::rename(&temp_path, target) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("rename failed: {e}"));
    }
    Ok(())
}

/// 같은 디렉토리에 temp file 쓴 후 rename — atomic write (텍스트).
fn atomic_write(target: &Path, content: &str) -> Result<(), String> {
    atomic_write_bytes(target, content.as_bytes())
}

/// 임의 경로에 바이너리 파일을 atomic하게 저장 (mermaid PNG 내보내기 등).
///
/// 경로는 save 다이얼로그로 사용자가 직접 고른 것이라 vault confine은 비적용 —
/// 의도적으로 vault 밖에도 저장 가능. 부모 디렉토리 부재/권한 에러는 Err로 전달.
/// bytes는 Frontend에서 `Array.from(Uint8Array)` → `Vec<u8>`로 역직렬화됨.
#[tauri::command]
pub async fn write_binary_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || atomic_write_bytes(&PathBuf::from(&path), &bytes))
        .await
        .map_err(|e| format!("write_binary_file join: {e}"))?
}

// Deserialize 추가: search-cache가 디스크에서 LinkInfo를 역직렬화해서 frontend로 그대로 돌려줌.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LinkInfo {
    pub source_path: String,
    pub source_name: String,
    pub title: Option<String>,
    pub aliases: Vec<String>,
    pub targets: Vec<String>,
    pub tags: Vec<String>,
    // SharedDocs 4키 스키마 (Markdown-Tag-Management-Guide.md §2)
    pub doc_kind: Option<String>, // requirements | spec | plan | solution | analysis | brainstorm | howto | reference | meeting-notes
    pub topic: Option<String>,    // kebab-case 단일
    pub related: Vec<String>,     // 파일 stem 배열 (cross-ref)
    /// Phase A 지식 그래프 — 모든 top-level frontmatter 키 → 값 목록 (generic).
    /// scalar→1원소, block/flow list→N원소. 인라인 콤마 split·경로 정규화는
    /// frontend(normalizeRef)가 담당 — 여기선 원형 보존. 중첩 객체(nested)는 skip.
    /// `#[serde(default)]` — 구 캐시(props 없는 v4 이하) 역직렬화 graceful.
    #[serde(default)]
    pub props: BTreeMap<String, Vec<String>>,
}

// `scan_links` Tauri 명령은 `read_vault_bundle` 도입 후 호출자 0 → 본 chore에서 제거.
// 단일 노트 link 추출은 `scan_link_single`(watcher 호환) 유지.

#[derive(Debug, Serialize, Clone)]
pub struct NoteContent {
    pub path: String,
    pub name: String,
    pub body: String,
}

/// 단일 노트의 LinkInfo만 추출 — file watcher의 증분 인덱싱용.
/// vault confine 검증 포함.
#[tauri::command]
pub fn scan_link_single(vault_path: String, path: String) -> Result<LinkInfo, String> {
    let vault = PathBuf::from(&vault_path)
        .canonicalize()
        .map_err(|e| format!("vault canonicalize failed: {e}"))?;
    let target = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| format!("target canonicalize failed: {e}"))?;
    if !target.starts_with(&vault) {
        return Err("path outside vault".to_string());
    }
    if target
        .extension()
        .is_none_or(|e| !e.eq_ignore_ascii_case("md"))
    {
        return Err("only .md files".to_string());
    }
    let content = fs::read_to_string(&target).map_err(|e| e.to_string())?;
    Ok(extract_link_info(&target, &content))
}

// `read_all_notes` 도 `read_vault_bundle` 도입 후 호출자 0 → 본 chore에서 제거.

/// vault cold-start 묶음 — `scan_links` + `read_all_notes`를 한 번에.
///
/// 이전 흐름은 `Promise.all([scanLinks, readAllNotes])`로 2개의 IPC + 2번의 walk +
/// 같은 파일을 2번 `read_to_string` (11000 노트면 22000 syscall). 본 함수는:
/// 1) **한 번만 walk**해서 .md 파일 경로 목록 수집
/// 2) **rayon `par_iter`로 병렬 `read_to_string`** + 한 read에서 LinkInfo +
///    NoteContent 둘 다 추출
/// 3) (links, contents)로 unzip
///
/// 단일 thread sync read 대비 디스크 I/O 큐 depth를 활용 → cold start 시간 큰 폭 단축 기대.
/// `LAPIS_PERF=1` 시 walk/read 분리 elapsed를 stderr + 응답 stats에 박제.
#[derive(Debug, Serialize, Clone, Default)]
pub struct VaultBundleStats {
    pub walk_ms: u128,
    pub read_ms: u128,
    pub file_count: usize,
}

#[derive(Debug, Serialize, Clone)]
pub struct VaultBundle {
    pub links: Vec<LinkInfo>,
    pub contents: Vec<NoteContent>,
    pub stats: VaultBundleStats,
}

#[tauri::command]
pub async fn read_vault_bundle(vault_path: String) -> Result<VaultBundle, String> {
    tauri::async_runtime::spawn_blocking(move || read_vault_bundle_inner(&vault_path))
        .await
        .map_err(|e| format!("read_vault_bundle join: {e}"))?
}

fn read_vault_bundle_inner(vault_path: &str) -> Result<VaultBundle, String> {
    let root = PathBuf::from(vault_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", vault_path));
    }

    let t_walk_start = Instant::now();
    let mut files: Vec<PathBuf> = Vec::new();
    walk_md_files(&root, &mut files).map_err(|e| e.to_string())?;
    let walk_ms = t_walk_start.elapsed().as_millis();

    let t_read_start = Instant::now();
    // par_iter — rayon 글로벌 thread pool에서 work-stealing 병렬 read_to_string.
    // 한 파일이 read 실패하면 silent skip (기존 `if let Ok(body)`와 동일 행동).
    let pairs: Vec<(LinkInfo, NoteContent)> = files
        .par_iter()
        .filter_map(|path| {
            let body = fs::read_to_string(path).ok()?;
            let link = extract_link_info(path, &body);
            let stem = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let content = NoteContent {
                path: path.to_string_lossy().to_string(),
                name: stem,
                body,
            };
            Some((link, content))
        })
        .collect();
    let read_ms = t_read_start.elapsed().as_millis();

    let mut links = Vec::with_capacity(pairs.len());
    let mut contents = Vec::with_capacity(pairs.len());
    for (l, c) in pairs {
        links.push(l);
        contents.push(c);
    }

    let stats = VaultBundleStats {
        walk_ms,
        read_ms,
        file_count: files.len(),
    };

    if perf_enabled() {
        eprintln!(
            "[lapis-perf] vault-bundle files={} walk={}ms read={}ms",
            stats.file_count, walk_ms, read_ms,
        );
    }

    Ok(VaultBundle {
        links,
        contents,
        stats,
    })
}

// ─── notes_mtimes ("안 본 사이 바뀐 노트"용) ─────────────────────────────────

/// 주어진 노트들의 mtime(ms)만 stat해서 돌려준다. **읽지 않는다**.
///
/// vault 전체를 걷지 않는 것이 요점 — 프론트가 "열람 이력이 있는 경로"만 보내므로
/// 12000노트 vault에서도 실제 stat 대상은 보통 수백 건이다(전수 walk는
/// vault_fingerprint가 이미 하고 있고, 여기선 그 비용을 다시 치를 이유가 없다).
///
/// 없어졌거나 vault 밖인 경로는 **에러 대신 결과에서 제외**한다. 열람 이력은 파일이
/// 지워져도 남아 있을 수 있어, 하나 없다고 전체 조회를 실패시키면 쓸모가 없다.
#[tauri::command]
pub async fn notes_mtimes(
    vault_path: String,
    paths: Vec<String>,
) -> Result<Vec<(String, u64)>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = canonicalize_vault(&vault_path)?;
        let mut out: Vec<(String, u64)> = Vec::with_capacity(paths.len());
        for p in paths {
            let Ok(canon) = PathBuf::from(&p).canonicalize() else {
                continue; // 삭제됨
            };
            if ensure_in_vault(&canon, &vault).is_err() {
                continue; // vault 밖 — 조용히 제외
            }
            let Ok(meta) = fs::metadata(&canon) else {
                continue;
            };
            let mtime_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            // 키는 **프론트가 보낸 원본 경로** — 프론트의 열람 이력 키와 맞춰야 한다
            // (canonicalize가 심링크를 풀어 다른 문자열이 될 수 있다).
            out.push((p, mtime_ms));
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("notes_mtimes join: {e}"))?
}

// ─── vault_fingerprint (검색 캐시용) ─────────────────────────────────────────

/// vault 모든 .md의 (rel_path, mtime_ms, size)를 정렬해 누적 hash. read 없음, stat만.
///
/// 같은 vault 두 호출이 결정론적으로 같은 값을 반환 — disk 캐시 invalidate 키로 사용.
/// 외부 도구가 mtime 갱신 없이 in-place write하는 케이스만 false negative (희박). size 변경
/// 만 있어도 catch.
#[derive(Debug, Serialize, Clone)]
pub struct VaultFingerprint {
    pub fingerprint: String,
    pub file_count: usize,
    pub walk_ms: u128,
}

#[tauri::command]
pub async fn vault_fingerprint(vault_path: String) -> Result<VaultFingerprint, String> {
    tauri::async_runtime::spawn_blocking(move || vault_fingerprint_inner(&vault_path))
        .await
        .map_err(|e| format!("vault_fingerprint join: {e}"))?
}

/// vault 파일 1건의 stat — **기동 델타 재조정**(`stores/vault.ts`)의 원자료.
///
/// `vault_fingerprint`는 "바뀌었다"만 알려주고 **무엇이** 바뀌었는지는 못 알려준다.
/// 그래서 노트 1개가 바뀌어도 vault 전량 재빌드였다. 같은 walk의 원자료를 그대로
/// 내보내면 프론트가 이전 스냅샷과 대조해 바뀐 파일만 고칠 수 있다.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileStat {
    /// **절대 경로.** `LinkInfo.source_path`와 같은 문자열이어야 델타를 그 키로 적용할 수
    /// 있다 — fingerprint 쪽이 쓰는 상대 경로를 그대로 내보내면 프론트가 다시 join 해야
    /// 하고, 그 join이 어긋나면 "전부 바뀐 것"으로 보여 델타가 매번 풀 빌드로 떨어진다.
    pub path: String,
    pub mtime_ms: u64,
    pub size: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct VaultFileStats {
    /// **이 목록과 같은 walk에서** 계산한 fingerprint. `vault_fingerprint`를 따로 부르면
    /// 두 walk 사이에 vault가 바뀌어 목록과 해시가 어긋난 스냅샷을 커밋하게 된다.
    pub fingerprint: String,
    pub files: Vec<FileStat>,
    pub walk_ms: u128,
}

/// 델타 계산용 — 정렬된 파일 stat 전량 + 같은 walk에서 계산한 fingerprint.
///
/// fingerprint가 어긋났을 때만 호출된다(hit 경로는 `vault_fingerprint`로 끝난다) —
/// 19,000 파일 목록을 매 기동 IPC로 넘길 이유가 없다.
#[tauri::command]
pub async fn vault_file_stats(vault_path: String) -> Result<VaultFileStats, String> {
    tauri::async_runtime::spawn_blocking(move || vault_file_stats_inner(&vault_path))
        .await
        .map_err(|e| format!("vault_file_stats join: {e}"))?
}

fn vault_file_stats_inner(vault_path: &str) -> Result<VaultFileStats, String> {
    let root = PathBuf::from(vault_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", vault_path));
    }
    let t0 = Instant::now();
    let (entries, fingerprint) = walk_and_fingerprint(&root)?;
    let files = entries
        .into_iter()
        .map(|(rel, mtime_ms, size)| FileStat {
            // `rel`은 `strip_prefix(root)`의 결과라 join이 walk가 본 경로를 그대로 복원한다.
            path: root.join(&rel).to_string_lossy().to_string(),
            mtime_ms: mtime_ms as u64,
            size,
        })
        .collect();
    Ok(VaultFileStats {
        fingerprint,
        files,
        walk_ms: t0.elapsed().as_millis(),
    })
}

/// walk가 파일 1건에서 뽑는 것 — `(vault 상대 경로, mtime_ms, size)`.
type WalkEntry = (String, u128, u64);

/// 정렬된 `WalkEntry` 목록 + 그 위에서 계산한 fingerprint.
///
/// `vault_fingerprint`와 `vault_file_stats`의 **단일 진실원**. 두 곳에 따로 두면 정렬
/// 기준이나 skip 규칙이 갈리는 순간 델타가 조용히 전량 변경으로 보인다.
fn walk_and_fingerprint(root: &Path) -> Result<(Vec<WalkEntry>, String), String> {
    let mut entries: Vec<WalkEntry> = Vec::new();
    walk_md_stats(root, root, &mut entries).map_err(|e| e.to_string())?;
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let mut hasher = DefaultHasher::new();
    for (p, m, s) in &entries {
        p.hash(&mut hasher);
        m.hash(&mut hasher);
        s.hash(&mut hasher);
    }
    Ok((entries, format!("{:016x}", hasher.finish())))
}

fn vault_fingerprint_inner(vault_path: &str) -> Result<VaultFingerprint, String> {
    let root = PathBuf::from(vault_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", vault_path));
    }
    let t0 = Instant::now();
    let (entries, fingerprint) = walk_and_fingerprint(&root)?;
    let walk_ms = t0.elapsed().as_millis();

    if perf_enabled() {
        eprintln!(
            "[lapis-perf] vault-fingerprint files={} elapsed={}ms fp={}",
            entries.len(),
            walk_ms,
            fingerprint,
        );
    }

    Ok(VaultFingerprint {
        fingerprint,
        file_count: entries.len(),
        walk_ms,
    })
}

/// vault root 기준 상대 경로 + mtime_ms(unix, 결정론) + file size를 수집.
fn walk_md_stats(root: &Path, current: &Path, out: &mut Vec<WalkEntry>) -> std::io::Result<()> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if SKIP_DIRS.iter().any(|d| *d == name) {
            continue;
        }
        if path.is_dir() {
            walk_md_stats(root, &path, out)?;
        } else if path.extension().is_some_and(is_supported_note_ext) {
            let meta = entry.metadata()?;
            let mtime_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis())
                .unwrap_or(0);
            let size = meta.len();
            let rel = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| path.to_string_lossy().to_string());
            out.push((rel, mtime_ms, size));
        }
    }
    Ok(())
}

/// recursive walk만 — read 없음. `walk_for_content`/`walk_for_links`의 push만 분리.
fn walk_md_files(current: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if SKIP_DIRS.iter().any(|d| *d == name) {
            continue;
        }
        if path.is_dir() {
            walk_md_files(&path, out)?;
        } else if path.extension().is_some_and(is_supported_note_ext) {
            out.push(path);
        }
    }
    Ok(())
}

// `walk_for_content` + `walk_for_links` 헬퍼는 dead 명령(`scan_links`, `read_all_notes`)
// 제거와 함께 본 chore에서 제거. 현재 walk 책임은 `walk_md_files`(`read_vault_bundle`용) +
// `walk_md_stats`(`vault_fingerprint`용) 두 가지로 분리.

fn extract_link_info(path: &Path, content: &str) -> LinkInfo {
    let source_name = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let (yaml_opt, body) = split_frontmatter(content);
    let mut title: Option<String> = None;
    let mut aliases: Vec<String> = Vec::new();
    let mut tags: Vec<String> = Vec::new();
    let mut doc_kind: Option<String> = None;
    let mut topic: Option<String> = None;
    let mut related: Vec<String> = Vec::new();
    let mut props: BTreeMap<String, Vec<String>> = BTreeMap::new();
    if let Some(yaml) = yaml_opt {
        parse_simple_frontmatter(
            yaml,
            &mut title,
            &mut aliases,
            &mut tags,
            &mut doc_kind,
            &mut topic,
            &mut related,
        );
        collect_all_props(yaml, &mut props);
    }

    let mut targets = extract_wikilinks(body);
    for t in extract_md_links(body) {
        if !targets
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&t))
        {
            targets.push(t);
        }
    }
    // 본문 inline `#tag` 추출은 폐기 — SharedDocs 4키 스키마(Markdown-Tag-Management-Guide.md)에서
    // "본문 내 inline 해시태그(#tag)는 사용하지 않는다"고 명시. frontmatter `tags`만 사용.
    // extract_inline_tags / is_heading_line 함수는 향후 복원 여지를 위해 dead code로 유지.

    LinkInfo {
        source_path: path.to_string_lossy().to_string(),
        source_name,
        title,
        aliases,
        targets,
        tags,
        doc_kind,
        topic,
        related,
        props,
    }
}

// `---\n…\n---\n` 형태만 인식. 단순 라인 매칭.
fn split_frontmatter(content: &str) -> (Option<&str>, &str) {
    if !content.starts_with("---") {
        return (None, content);
    }
    let after_first_marker = &content[3..];
    let line_end = match after_first_marker.find('\n') {
        Some(i) => i,
        None => return (None, content),
    };
    // 첫 줄에 "---" 외 내용이 있으면 frontmatter 아님
    if !after_first_marker[..line_end].trim().is_empty() {
        return (None, content);
    }
    let after_open_line = &after_first_marker[line_end + 1..];
    if let Some(close_idx) = after_open_line.find("\n---") {
        let yaml = &after_open_line[..close_idx];
        let after_close = &after_open_line[close_idx + 4..]; // skip "\n---"
        let body_offset = after_close
            .find('\n')
            .map(|n| n + 1)
            .unwrap_or(after_close.len());
        return (Some(yaml), &after_close[body_offset..]);
    }
    (None, content)
}

#[allow(clippy::too_many_arguments)]
fn parse_simple_frontmatter(
    yaml: &str,
    title: &mut Option<String>,
    aliases: &mut Vec<String>,
    tags: &mut Vec<String>,
    doc_kind: &mut Option<String>,
    topic: &mut Option<String>,
    related: &mut Vec<String>,
) {
    let lines: Vec<&str> = yaml.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if let Some(rest) = line.strip_prefix("title:") {
            *title = Some(strip_quotes(rest.trim()).to_string());
        } else if let Some(rest) = line.strip_prefix("doc_kind:") {
            // SharedDocs 4키 스키마 §2.1 — 단일 enum 값
            let v = strip_quotes(rest.trim());
            if !v.is_empty() {
                *doc_kind = Some(v.to_string());
            }
        } else if let Some(rest) = line.strip_prefix("topic:") {
            // §2.2 — kebab-case 단일 값
            let v = strip_quotes(rest.trim());
            if !v.is_empty() {
                *topic = Some(v.to_string());
            }
        } else if let Some(rest) = line.strip_prefix("aliases:") {
            if let Some(consumed) = parse_yaml_list(rest, &lines, i, aliases) {
                i = consumed;
                continue;
            }
        } else if let Some(rest) = line.strip_prefix("tags:") {
            if let Some(consumed) = parse_yaml_list(rest, &lines, i, tags) {
                i = consumed;
                continue;
            }
        } else if let Some(rest) = line.strip_prefix("related:") {
            // §2.4 — 파일 stem 배열
            if let Some(consumed) = parse_yaml_list(rest, &lines, i, related) {
                i = consumed;
                continue;
            }
        }
        i += 1;
    }
}

/// `key: [a, b]` 인라인 또는 `key:\n  - a\n  - b` 멀티라인 YAML 리스트를 out에 push.
/// 멀티라인을 소비했으면 다음에 처리할 line index를 Some으로 반환.
fn parse_yaml_list(
    after_key: &str,
    lines: &[&str],
    start_line: usize,
    out: &mut Vec<String>,
) -> Option<usize> {
    let rest = after_key.trim();
    if let Some(inner) = rest.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
        for item in inner.split(',') {
            let v = strip_quotes(item.trim());
            if !v.is_empty() {
                out.push(v.to_string());
            }
        }
        return None;
    }
    if !rest.is_empty() {
        return None;
    }
    let mut i = start_line + 1;
    while i < lines.len() {
        let l = lines[i].trim();
        if let Some(item) = l.strip_prefix('-') {
            let v = strip_quotes(item.trim());
            if !v.is_empty() {
                out.push(v.to_string());
            }
            i += 1;
        } else {
            break;
        }
    }
    Some(i)
}

fn strip_quotes(s: &str) -> &str {
    let s = s.trim();
    if (s.starts_with('"') && s.ends_with('"') && s.len() >= 2)
        || (s.starts_with('\'') && s.ends_with('\'') && s.len() >= 2)
    {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

/// Phase A 지식 그래프 — 모든 top-level frontmatter 키를 generic하게 수집.
/// 그룹핑(필드 렌즈, A-1)과 관계 감지(A-2)의 원천.
///
/// 규칙:
/// - **col 0(들여쓰기 없음) `key: ...` 라인만** 키로 인정. 들여쓴 줄(중첩/연속)·빈 줄·
///   `#` 주석·`-` 고아 list 항목은 skip → 중첩 객체(`metadata:` 하위)는 자동 제외.
/// - 값: 인라인 `[a, b]` → comma split / scalar → 1원소(원형 보존) / 빈 값 → 뒤따르는 `- ` block list.
/// - 인라인 콤마 scalar(`a.md, b.md`)는 **split 안 함**(1원소) — 경로/콤마/꼬리주석 정규화는
///   frontend `normalizeRef`가 담당(거짓 split 방지). 빈 값+list 없음 → 미수집.
fn collect_all_props(yaml: &str, props: &mut BTreeMap<String, Vec<String>>) {
    let lines: Vec<&str> = yaml.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        // 들여쓴 줄(nested/continuation)은 top-level 키 아님
        if line.starts_with(' ') || line.starts_with('\t') {
            i += 1;
            continue;
        }
        let trimmed = line.trim_start();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('-') {
            i += 1;
            continue;
        }
        let Some(colon) = line.find(':') else {
            i += 1;
            continue;
        };
        let key = line[..colon].trim();
        if key.is_empty() {
            i += 1;
            continue;
        }
        let (values, next_i) = collect_prop_values(&line[colon + 1..], &lines, i);
        if !values.is_empty() {
            props.entry(key.to_string()).or_default().extend(values);
        }
        i = next_i;
    }
}

/// `collect_all_props`용 값 수집. 반환: (값 목록, 다음에 처리할 line index).
fn collect_prop_values(after_key: &str, lines: &[&str], start_line: usize) -> (Vec<String>, usize) {
    let rest = after_key.trim();
    // 인라인 flow list `[a, b]`
    if let Some(inner) = rest.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
        let mut out = Vec::new();
        for item in inner.split(',') {
            let v = strip_quotes(item.trim());
            if !v.is_empty() {
                out.push(v.to_string());
            }
        }
        return (out, start_line + 1);
    }
    // scalar — 원형 보존 (콤마 split·경로 정규화는 frontend)
    if !rest.is_empty() {
        let v = strip_quotes(rest);
        let out = if v.is_empty() {
            Vec::new()
        } else {
            vec![v.to_string()]
        };
        return (out, start_line + 1);
    }
    // 빈 값 → 뒤따르는 들여쓴 `- item` block list
    let mut out = Vec::new();
    let mut i = start_line + 1;
    while i < lines.len() {
        let lt = lines[i].trim_start();
        if let Some(item) = lt.strip_prefix('-') {
            let v = strip_quotes(item.trim());
            if !v.is_empty() {
                out.push(v.to_string());
            }
            i += 1;
        } else {
            break;
        }
    }
    (out, i)
}

// 본문에서 `#tag` 추출. 다음은 모두 무시:
// - 코드 펜스(``` 라인)와 인라인 코드(`...`) 안
// - 마크다운 헤딩 라인 (`# `, `## `, ... `###### ` 시작) — 글 구조이지 태그 추출 대상 아님
// 단어 경계: 직전 글자가 영숫자/_가 아닌 경우만 인정.
// 태그 인정 조건: 첫 글자가 알파벳(영문/한글/Unicode letter) — 숫자/구분자 시작 거름.
//
// NOTE: SharedDocs 4키 스키마 도입(Phase 3.0)으로 호출 중단. 향후 복원 여지를 위해 보존.
#[allow(dead_code)]
fn extract_inline_tags(body: &str) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();
    let mut in_fence = false;

    for line in body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        // 마크다운 헤딩 라인 skip — 헤딩의 #ifdef, #F-XX, 한글 조사 패턴(#4의) 등 자동 제거
        if is_heading_line(trimmed) {
            continue;
        }

        // 인라인 코드 (` 사이) 제거
        let mut cleaned = String::with_capacity(line.len());
        let mut in_inline = false;
        for c in line.chars() {
            if c == '`' {
                in_inline = !in_inline;
                continue;
            }
            if !in_inline {
                cleaned.push(c);
            }
        }

        let chars: Vec<char> = cleaned.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            if chars[i] != '#' {
                i += 1;
                continue;
            }
            // 단어 경계 체크
            if i > 0 {
                let p = chars[i - 1];
                if p.is_alphanumeric() || p == '_' {
                    i += 1;
                    continue;
                }
            }
            let mut j = i + 1;
            while j < chars.len() {
                let c = chars[j];
                if c.is_alphanumeric() || c == '_' || c == '-' || c == '/' {
                    j += 1;
                } else {
                    break;
                }
            }
            if j > i + 1 {
                let raw: String = chars[i + 1..j].iter().collect();
                let trimmed = raw.trim_end_matches(['-', '/']);
                // 첫 글자가 알파벳(영문/한글/Unicode letter)이어야 태그로 인정.
                // 다음 패턴 모두 거름:
                // - #1, #2026, #404 (PR/연도/이슈 번호)
                // - #1-chatroom, #4-image-loading (숫자 prefix — 의도적이라면 #chatroom-v2 식으로 재작성 권장)
                // - #4의, #3의, #10에 (한국어 조사 패턴)
                // - #/path, #-foo (구분자 시작)
                let starts_with_letter = trimmed.chars().next().is_some_and(|c| c.is_alphabetic());
                if starts_with_letter
                    && !result
                        .iter()
                        .any(|t: &String| t.eq_ignore_ascii_case(trimmed))
                {
                    result.push(trimmed.to_string());
                }
            }
            i = j;
        }
    }

    result
}

// ATX 마크다운 헤딩 라인인지 — `#{1,6}` + 공백/탭 시작.
// `# Title`, `## Sub`, ..., `###### Deep` 모두 헤딩.
// `#noSpace`, `####### too-many` 는 헤딩 아님.
//
// NOTE: extract_inline_tags가 dead code가 되면서 이 헬퍼도 미사용. 같이 보존.
#[allow(dead_code)]
fn is_heading_line(trimmed: &str) -> bool {
    let bytes = trimmed.as_bytes();
    let mut hash_count = 0;
    while hash_count < bytes.len() && bytes[hash_count] == b'#' {
        hash_count += 1;
    }
    if hash_count == 0 || hash_count > 6 {
        return false;
    }
    if hash_count >= bytes.len() {
        return false; // `#` 만 있는 라인
    }
    let next = bytes[hash_count];
    next == b' ' || next == b'\t'
}

// 한 줄에서 인라인 코드(`...`) 부분을 제거.
fn strip_inline_code(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut in_code = false;
    for c in line.chars() {
        if c == '`' {
            in_code = !in_code;
            continue;
        }
        if !in_code {
            out.push(c);
        }
    }
    out
}

// "name.md" / "name.MD" / "name.mmd" → "name".
// 확장자 검사는 바이트 슬라이스(&[u8])로 — char 경계와 무관하게 안전.
// 한글 등 멀티바이트 글자로 끝나는 이름에서 str 슬라이스(`&name[len-4..]`)는 char
// 경계를 침범해 panic하므로 검사용 슬라이스는 반드시 바이트로 한다.
// 반환 슬라이스 len-4/len-3은 확장자가 ASCII로 매칭됐을 때만 도달 → '.' 위치(char 경계)라 안전.
fn strip_md_extension(name: &str) -> &str {
    let b = name.as_bytes();
    if b.len() >= 4 && b[b.len() - 4..].eq_ignore_ascii_case(b".mmd") {
        return &name[..name.len() - 4];
    }
    if b.len() >= 3 && b[b.len() - 3..].eq_ignore_ascii_case(b".md") {
        return &name[..name.len() - 3];
    }
    name
}

// `[[...]]` 추출. 코드 펜스(```...```)와 인라인 코드(`...`) 안은 무시.
// 중첩 `[[` 거부.
fn extract_wikilinks(body: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut in_fence = false;

    for line in body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }

        let cleaned = strip_inline_code(line);
        let mut rest = cleaned.as_str();
        while let Some(start) = rest.find("[[") {
            let after_open = &rest[start + 2..];
            if let Some(close_offset) = after_open.find("]]") {
                let inner = &after_open[..close_offset];
                if !inner.contains('\n') && !inner.contains("[[") {
                    let t = inner.trim();
                    if !t.is_empty() {
                        result.push(t.to_string());
                    }
                }
                rest = &after_open[close_offset + 2..];
            } else {
                break;
            }
        }
    }

    result
}

// `[text](path)` 패턴에서 .md 확장자 가진 path만 추출.
// path → last segment에서 .md 제거 → wikilink target과 동일 형식.
// 코드 펜스 / 인라인 코드 안은 무시.
fn extract_md_links(body: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut in_fence = false;

    for line in body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }

        let cleaned = strip_inline_code(line);
        // ](path) 패턴 — `]`와 `(`가 인접한 경우만
        let mut rest = cleaned.as_str();
        while let Some(idx) = rest.find("](") {
            let after = &rest[idx + 2..];
            if let Some(close) = after.find(')') {
                let path = &after[..close];
                // anchor (`#section`) 제거, query 제거
                let path_clean = path.split(['#', '?']).next().unwrap_or(path).trim();
                let lower = path_clean.to_lowercase();
                if lower.ends_with(".md")
                    && !path_clean.starts_with("http://")
                    && !path_clean.starts_with("https://")
                    && !path_clean.starts_with("mailto:")
                {
                    let last = path_clean.rsplit('/').next().unwrap_or(path_clean);
                    let stem = strip_md_extension(last).trim();
                    if !stem.is_empty() {
                        result.push(stem.to_string());
                    }
                }
                rest = &after[close + 1..];
            } else {
                break;
            }
        }
    }

    result
}

fn walk_dir(root: &Path, current: &Path) -> std::io::Result<Vec<NoteEntry>> {
    let mut entries: Vec<NoteEntry> = Vec::new();

    for entry in fs::read_dir(current)? {
        let entry = entry?;
        let path = entry.path();
        let name_os = entry.file_name();
        let name = name_os.to_string_lossy().to_string();

        if name.starts_with('.') {
            continue;
        }
        if SKIP_DIRS.iter().any(|d| *d == name) {
            continue;
        }

        let rel_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();

        if path.is_dir() {
            let children = walk_dir(root, &path)?;
            if children.is_empty() {
                continue;
            }
            entries.push(NoteEntry {
                path: path.to_string_lossy().to_string(),
                rel_path,
                name,
                is_dir: true,
                children: Some(children),
            });
        } else if path.extension().is_some_and(is_supported_note_ext) {
            let stem = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| name.clone());
            entries.push(NoteEntry {
                path: path.to_string_lossy().to_string(),
                rel_path,
                name: stem,
                is_dir: false,
                children: None,
            });
        }
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn props_of(yaml: &str) -> BTreeMap<String, Vec<String>> {
        let mut p = BTreeMap::new();
        collect_all_props(yaml, &mut p);
        p
    }

    #[test]
    fn props_block_list() {
        let p = props_of("related:\n  - plans/a.md\n  - plans/b.md");
        assert_eq!(
            p.get("related").unwrap(),
            &vec!["plans/a.md".to_string(), "plans/b.md".to_string()]
        );
    }

    #[test]
    fn props_inline_bracket_list() {
        let p = props_of("depends_on: [phase-5.1.md]");
        assert_eq!(
            p.get("depends_on").unwrap(),
            &vec!["phase-5.1.md".to_string()]
        );
    }

    #[test]
    fn props_inline_comma_scalar_not_split() {
        // 콤마 split은 frontend(normalizeRef) 책임 — 파서는 원형 1원소 보존.
        let p = props_of("supersedes: a.md, b.md");
        assert_eq!(
            p.get("supersedes").unwrap(),
            &vec!["a.md, b.md".to_string()]
        );
    }

    #[test]
    fn props_scalar_path_and_annotation_preserved() {
        let p = props_of(
            "status: in-progress\nparent_plan: phase-4.3-x.md\nrelated: brainstorms/x.md (deferred)",
        );
        assert_eq!(p.get("status").unwrap(), &vec!["in-progress".to_string()]);
        assert_eq!(
            p.get("parent_plan").unwrap(),
            &vec!["phase-4.3-x.md".to_string()]
        );
        // 경로 + 꼬리 주석은 원형 보존 — 정규화는 frontend.
        assert_eq!(
            p.get("related").unwrap(),
            &vec!["brainstorms/x.md (deferred)".to_string()]
        );
    }

    #[test]
    fn props_strip_quotes() {
        let p = props_of("title: \"Hello World\"");
        assert_eq!(p.get("title").unwrap(), &vec!["Hello World".to_string()]);
    }

    #[test]
    fn props_skips_nested_objects() {
        // 중첩 객체(들여쓴 child)는 top-level 아님 → 미수집. 빈 값 부모도 미수집.
        let p = props_of("metadata:\n  type: feedback\n  scope: x");
        assert!(!p.contains_key("metadata"));
        assert!(!p.contains_key("type"));
        assert!(!p.contains_key("scope"));
    }

    #[test]
    fn props_skips_comments_and_blanks() {
        let p = props_of("# comment\n\nstatus: done");
        assert_eq!(p.get("status").unwrap(), &vec!["done".to_string()]);
        assert!(!p.contains_key("# comment"));
    }

    #[test]
    fn props_empty_value_then_next_key() {
        // 빈 값 키(`related_brainstorm:`) 다음 줄이 또 다른 top-level 키면 미수집 + 다음 키 정상 처리.
        let p = props_of("related_brainstorm:\ndepends_on: [x.md]");
        assert!(!p.contains_key("related_brainstorm"));
        assert_eq!(p.get("depends_on").unwrap(), &vec!["x.md".to_string()]);
    }

    #[test]
    fn extract_link_info_typed_fields_coexist_with_props() {
        let content = "---\ntitle: My Note\ntags: [alpha, beta]\nrelated:\n  - other-note\ntype: brainstorm\nstatus: draft\n---\n\nbody [[wiki-target]]";
        let info = extract_link_info(&PathBuf::from("/v/my.md"), content);
        // typed 필드 back-compat — 기존 인덱스 소비자 무영향.
        assert_eq!(info.title.as_deref(), Some("My Note"));
        assert_eq!(info.tags, vec!["alpha".to_string(), "beta".to_string()]);
        assert_eq!(info.related, vec!["other-note".to_string()]);
        // generic props 동시 수집 (그룹핑용 type/status 포함).
        assert_eq!(
            info.props.get("type").unwrap(),
            &vec!["brainstorm".to_string()]
        );
        assert_eq!(
            info.props.get("status").unwrap(),
            &vec!["draft".to_string()]
        );
        // 본문 wikilink는 targets (props 아님).
        assert!(info.targets.iter().any(|t| t == "wiki-target"));
    }

    /// 고유 임시 디렉토리 생성 (pid + nanos). 테스트 종료 시 호출자가 remove_dir_all.
    fn unique_tmp_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let mut dir = std::env::temp_dir();
        dir.push(format!("lapis-test-{tag}-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn walkers_count_md_and_mmd_consistently() {
        // 회귀: 트리 워커(walk_dir)는 .mmd / 대문자 .MD를 포함하는데 fingerprint(walk_md_stats)
        // 와 bundle(walk_md_files) 워커가 소문자 .md만 세면 → 그런 파일이 트리엔 보이지만
        // fingerprint를 안 바꿔 stale 캐시 HIT → cmd+k 검색에서 누락(파일 필터엔 보임).
        // 세 워커 모두 is_supported_note_ext로 통일됐는지 검증한다.
        let dir = unique_tmp_dir("walkers");
        fs::write(dir.join("a.md"), "# A").unwrap();
        fs::write(dir.join("b.mmd"), "graph TD;").unwrap();
        fs::write(dir.join("c.MD"), "# C").unwrap();
        fs::write(dir.join(".hidden.md"), "# hidden").unwrap(); // dot-파일 제외
        fs::write(dir.join("note.txt"), "plain").unwrap(); // 비지원 확장자 제외
        fs::create_dir_all(dir.join("node_modules")).unwrap();
        fs::write(dir.join("node_modules/x.md"), "# skip").unwrap(); // SKIP_DIRS 제외

        let dir_str = dir.to_string_lossy().to_string();

        // fingerprint 워커: a.md / b.mmd / c.MD 3개 (hidden·txt·node_modules 제외)
        let fp = vault_fingerprint_inner(&dir_str).unwrap();
        assert_eq!(
            fp.file_count, 3,
            "fingerprint은 .md+.mmd(대소문자 무관) 3개를 세야 함"
        );

        // bundle 워커: 동일하게 3개 LinkInfo
        let bundle = read_vault_bundle_inner(&dir_str).unwrap();
        assert_eq!(
            bundle.links.len(),
            3,
            "bundle도 .md+.mmd 3개를 인덱싱해야 함"
        );

        // .mmd 파일을 추가하면 fingerprint가 달라져야(=캐시 무효화) 한다.
        let fp_before = fp.fingerprint.clone();
        fs::write(dir.join("d.mmd"), "graph LR;").unwrap();
        let fp_after = vault_fingerprint_inner(&dir_str).unwrap();
        assert_ne!(
            fp_before, fp_after.fingerprint,
            ".mmd 추가 시 fingerprint 변경되어야 함"
        );
        assert_eq!(fp_after.file_count, 4);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn file_stats_paths_match_bundle_and_fingerprint() {
        // 델타 재조정의 두 전제를 고정한다.
        //
        // ① **경로 문자열이 `LinkInfo.source_path`와 같아야 한다.** fingerprint 쪽은
        //    상대 경로를 쓰는데 프론트는 절대 경로를 키로 델타를 적용한다. join이
        //    어긋나면 전부 "새 파일"로 보여 델타가 매번 풀 빌드로 떨어진다 — 조용히,
        //    느려지기만 하면서.
        // ② **fingerprint가 `vault_fingerprint`의 것과 같아야 한다.** 두 값이 갈리면
        //    stats 거부 판정(`stats_reject_reason`)이 항상 걸려 델타가 영영 안 돈다.
        let dir = unique_tmp_dir("filestats");
        fs::write(dir.join("a.md"), "# A").unwrap();
        fs::write(dir.join("b.mmd"), "graph TD;").unwrap();
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("sub/c.md"), "# C").unwrap();
        let dir_str = dir.to_string_lossy().to_string();

        let stats = vault_file_stats_inner(&dir_str).unwrap();
        let bundle = read_vault_bundle_inner(&dir_str).unwrap();

        let mut stat_paths: Vec<String> = stats.files.iter().map(|f| f.path.clone()).collect();
        let mut link_paths: Vec<String> =
            bundle.links.iter().map(|l| l.source_path.clone()).collect();
        stat_paths.sort();
        link_paths.sort();
        assert_eq!(stat_paths, link_paths, "① stat 경로 = LinkInfo.source_path");

        let fp = vault_fingerprint_inner(&dir_str).unwrap();
        assert_eq!(stats.fingerprint, fp.fingerprint, "② 같은 walk = 같은 해시");
        assert_eq!(stats.files.len(), fp.file_count);

        // 내용을 바꾸면 그 파일의 stat만 달라져야 한다(= 델타가 1건).
        fs::write(dir.join("a.md"), "# A longer body").unwrap();
        let after = vault_file_stats_inner(&dir_str).unwrap();
        let before_by_path: std::collections::HashMap<_, _> =
            stats.files.iter().map(|f| (&f.path, f)).collect();
        let changed: Vec<&str> = after
            .files
            .iter()
            .filter(|f| match before_by_path.get(&f.path) {
                Some(b) => b.mtime_ms != f.mtime_ms || b.size != f.size,
                None => true,
            })
            .map(|f| f.path.as_str())
            .collect();
        assert_eq!(
            changed.len(),
            1,
            "바뀐 파일만 델타에 잡혀야 한다: {changed:?}"
        );
        assert!(changed[0].ends_with("a.md"), "changed={changed:?}");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn strip_md_extension_handles_multibyte_before_ext() {
        // 회귀: 한글 등 멀티바이트 글자로 끝나는 이름에서 char 경계 침범 panic 방지.
        // (release `panic = "abort"`라 이 panic은 앱 전체 즉시 크래시였음 — vault.rs:1163)
        assert_eq!(strip_md_extension("현황검토서.md"), "현황검토서");
        assert_eq!(strip_md_extension("다이어그램.mmd"), "다이어그램");
        assert_eq!(strip_md_extension("plan.MD"), "plan");
        assert_eq!(strip_md_extension("note.md"), "note");
        assert_eq!(strip_md_extension("서"), "서"); // 확장자보다 짧음 — panic 없어야
        assert_eq!(strip_md_extension("noext"), "noext");
    }
}
