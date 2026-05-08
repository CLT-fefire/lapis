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
