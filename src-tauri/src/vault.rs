use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Clone)]
pub struct NoteEntry {
    pub path: String,
    pub rel_path: String,
    pub name: String,
    pub is_dir: bool,
    pub children: Option<Vec<NoteEntry>>,
}

const SKIP_DIRS: &[&str] = &["node_modules", "target", ".svelte-kit", "build", "dist", ".git"];

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
    let target = PathBuf::from(&path);
    let vault = PathBuf::from(&vault_path)
        .canonicalize()
        .map_err(|e| format!("vault canonicalize failed: {e}"))?;

    let target_canon = target
        .canonicalize()
        .map_err(|e| format!("target canonicalize failed: {e}"))?;

    if !target_canon.starts_with(&vault) {
        return Err(format!(
            "path traversal detected: {} is outside {}",
            target_canon.display(),
            vault.display()
        ));
    }

    if target_canon
        .extension()
        .is_none_or(|e| !e.eq_ignore_ascii_case("md"))
    {
        return Err("only .md files allowed".to_string());
    }

    let dir = target_canon
        .parent()
        .ok_or_else(|| "no parent directory".to_string())?;
    let file_name = target_canon
        .file_name()
        .ok_or_else(|| "no file name".to_string())?
        .to_string_lossy()
        .to_string();

    let pid = std::process::id();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let temp_name = format!(".{file_name}.tmp.lapis-{pid}-{nanos}");
    let temp_path = dir.join(temp_name);

    if let Err(e) = fs::write(&temp_path, &content) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("temp write failed: {e}"));
    }

    if let Err(e) = fs::rename(&temp_path, &target_canon) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("rename failed: {e}"));
    }

    Ok(())
}

#[derive(Debug, Serialize, Clone)]
pub struct LinkInfo {
    pub source_path: String,
    pub source_name: String,
    pub title: Option<String>,
    pub aliases: Vec<String>,
    pub targets: Vec<String>,
    pub tags: Vec<String>,
}

#[tauri::command]
pub fn scan_links(vault_path: String) -> Result<Vec<LinkInfo>, String> {
    let root = PathBuf::from(&vault_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", vault_path));
    }
    let mut out = Vec::new();
    walk_for_links(&root, &mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

#[derive(Debug, Serialize, Clone)]
pub struct NoteContent {
    pub path: String,
    pub name: String,
    pub body: String,
}

#[tauri::command]
pub fn read_all_notes(vault_path: String) -> Result<Vec<NoteContent>, String> {
    let root = PathBuf::from(&vault_path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", vault_path));
    }
    let mut out = Vec::new();
    walk_for_content(&root, &mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

fn walk_for_content(current: &Path, out: &mut Vec<NoteContent>) -> std::io::Result<()> {
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
            walk_for_content(&path, out)?;
        } else if path.extension().is_some_and(|e| e == "md") {
            if let Ok(body) = fs::read_to_string(&path) {
                let stem = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                out.push(NoteContent {
                    path: path.to_string_lossy().to_string(),
                    name: stem,
                    body,
                });
            }
        }
    }
    Ok(())
}

fn walk_for_links(current: &Path, out: &mut Vec<LinkInfo>) -> std::io::Result<()> {
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
            walk_for_links(&path, out)?;
        } else if path.extension().is_some_and(|e| e == "md") {
            if let Ok(content) = fs::read_to_string(&path) {
                out.push(extract_link_info(&path, &content));
            }
        }
    }
    Ok(())
}

fn extract_link_info(path: &Path, content: &str) -> LinkInfo {
    let source_name = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let (yaml_opt, body) = split_frontmatter(content);
    let mut title: Option<String> = None;
    let mut aliases: Vec<String> = Vec::new();
    let mut tags: Vec<String> = Vec::new();
    if let Some(yaml) = yaml_opt {
        parse_simple_frontmatter(yaml, &mut title, &mut aliases, &mut tags);
    }

    let mut targets = extract_wikilinks(body);
    for t in extract_md_links(body) {
        if !targets.iter().any(|existing| existing.eq_ignore_ascii_case(&t)) {
            targets.push(t);
        }
    }
    let inline_tags = extract_inline_tags(body);
    for t in inline_tags {
        if !tags.iter().any(|existing| existing.eq_ignore_ascii_case(&t)) {
            tags.push(t);
        }
    }

    LinkInfo {
        source_path: path.to_string_lossy().to_string(),
        source_name,
        title,
        aliases,
        targets,
        tags,
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
        let body_offset = after_close.find('\n').map(|n| n + 1).unwrap_or(after_close.len());
        return (Some(yaml), &after_close[body_offset..]);
    }
    (None, content)
}

fn parse_simple_frontmatter(
    yaml: &str,
    title: &mut Option<String>,
    aliases: &mut Vec<String>,
    tags: &mut Vec<String>,
) {
    let lines: Vec<&str> = yaml.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if let Some(rest) = line.strip_prefix("title:") {
            *title = Some(strip_quotes(rest.trim()).to_string());
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

// 본문에서 `#tag` 추출. 코드 펜스(``` 라인)와 인라인 코드(`...`) 안은 무시.
// 단어 경계: 직전 글자가 영숫자/_가 아닌 경우만 인정 (URL fragment 제외).
// 태그 본문: 영숫자, _, -, /, 비ASCII(한글 등)
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
                let trimmed = raw.trim_end_matches(|c: char| c == '-' || c == '/');
                // 순수 숫자(예: #2026)는 태그가 아닐 가능성 높지만 일단 허용 — 사용자가 의도한 #2026 같은 연도 태그도 흔함
                if !trimmed.is_empty()
                    && !result.iter().any(|t: &String| t.eq_ignore_ascii_case(trimmed))
                {
                    result.push(trimmed.to_string());
                }
            }
            i = j;
        }
    }

    result
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

// "name.md" / "name.MD" → "name". ASCII 확장자라 byte slice 안전.
fn strip_md_extension(name: &str) -> &str {
    if name.len() >= 3 {
        let tail = &name[name.len() - 3..];
        if tail.eq_ignore_ascii_case(".md") {
            return &name[..name.len() - 3];
        }
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
        } else if path.extension().is_some_and(|ext| ext == "md") {
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
