use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

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

#[derive(Debug, Serialize, Clone)]
pub struct LinkInfo {
    pub source_path: String,
    pub source_name: String,
    pub title: Option<String>,
    pub aliases: Vec<String>,
    pub targets: Vec<String>,
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
    if let Some(yaml) = yaml_opt {
        parse_simple_frontmatter(yaml, &mut title, &mut aliases);
    }

    let targets = extract_wikilinks(body);

    LinkInfo {
        source_path: path.to_string_lossy().to_string(),
        source_name,
        title,
        aliases,
        targets,
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

fn parse_simple_frontmatter(yaml: &str, title: &mut Option<String>, aliases: &mut Vec<String>) {
    let lines: Vec<&str> = yaml.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if let Some(rest) = line.strip_prefix("title:") {
            *title = Some(strip_quotes(rest.trim()).to_string());
        } else if let Some(rest) = line.strip_prefix("aliases:") {
            let rest = rest.trim();
            if let Some(inner) = rest.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
                for item in inner.split(',') {
                    let v = strip_quotes(item.trim());
                    if !v.is_empty() {
                        aliases.push(v.to_string());
                    }
                }
            } else if rest.is_empty() {
                i += 1;
                while i < lines.len() {
                    let l = lines[i].trim();
                    if let Some(item) = l.strip_prefix('-') {
                        let v = strip_quotes(item.trim());
                        if !v.is_empty() {
                            aliases.push(v.to_string());
                        }
                        i += 1;
                    } else {
                        break;
                    }
                }
                continue;
            }
        }
        i += 1;
    }
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

// `[[...]]` 추출. 한 줄 안에서만 인정. 중첩 `[[` 거부.
fn extract_wikilinks(body: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut rest = body;
    while let Some(start) = rest.find("[[") {
        let after_open = &rest[start + 2..];
        if let Some(close_offset) = after_open.find("]]") {
            let inner = &after_open[..close_offset];
            if !inner.contains('\n') && !inner.contains("[[") {
                let trimmed = inner.trim();
                if !trimmed.is_empty() {
                    result.push(trimmed.to_string());
                }
            }
            rest = &after_open[close_offset + 2..];
        } else {
            break;
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
