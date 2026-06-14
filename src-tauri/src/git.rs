//! vault git 버전관리 백엔드 (ADR-004).
//!
//! 자체 VCS를 만들지 않고 **git CLI를 shell-out**으로 호출한다(`git2`/libgit2 대형 의존성
//! 회피 — Lapis "외부 crate 최소" 철학). 모든 호출은 인자 배열로 넘겨 shell을 거치지 않으므로
//! injection이 없다. opt-in: `git_init`을 명시적으로 부를 때만 vault에 `.git` 생성.
//!
//! ⚠️ 모든 command는 **async fn + `spawn_blocking`**으로 무거운 git IO를 worker thread에 격리한다.
//! sync `#[tauri::command]`로 두면 거대 vault의 `git init`/`add -A`가 main IPC 핸들러 스레드를
//! 점유해 그동안 모든 invoke가 막혀 UI가 수십 초 freeze 된다
//! ([solution](../../docs/solutions/tauri-issues/tauri-sync-command-emit-ipc-race-20260513.md)).
//! 실제 로직은 sync `*_inner` 함수에 두어 단위 테스트가 가능하다.
//!
//! 노이즈(`_memories/` 등 claude-mem 자동 export)는 `.gitignore`로 제외 — 실제 대상은
//! non-`_memories` 문서뿐이라 가볍다. 커밋은 user.name/email을 인라인(`-c`)으로 지정해
//! 전역 git config에 의존하지 않는다.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::async_runtime::spawn_blocking;

/// vault 루트 canonicalize (존재해야 함).
fn canon_vault(vault_path: &str) -> Result<PathBuf, String> {
    PathBuf::from(vault_path)
        .canonicalize()
        .map_err(|e| format!("vault canonicalize 실패: {e}"))
}

/// 노트 절대경로 → vault 기준 상대경로(POSIX 구분자). vault 밖이면 에러(path traversal 차단).
fn rel_in_vault(vault: &Path, path: &str) -> Result<String, String> {
    let target = PathBuf::from(path)
        .canonicalize()
        .map_err(|e| format!("path canonicalize 실패: {e}"))?;
    let rel = target
        .strip_prefix(vault)
        .map_err(|_| "path가 vault 밖입니다".to_string())?;
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

/// git 실행 — 인자 배열(shell 미경유). 성공 시 stdout, 실패 시 stderr(trim).
fn run_git(repo: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .current_dir(repo)
        .args(args)
        .output()
        .map_err(|e| format!("git 실행 실패 (설치 확인): {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// 버전관리 시작 시 생성하는 `.gitignore` — claude-mem export 등 노이즈 제외.
const GITIGNORE: &str = "# Lapis 버전관리 — 노이즈 제외 (ADR-004)\n_memories/\n.DS_Store\n.lapis/\n*.tmp.lapis-*\n";

/// 노트 1건의 commit 이력 항목.
#[derive(Debug, Serialize)]
pub struct GitCommit {
    /// 전체 hash.
    pub hash: String,
    /// 짧은 hash(표시용).
    pub short: String,
    /// author 이름.
    pub author: String,
    /// author 시각(epoch seconds).
    pub timestamp: i64,
    /// commit 제목(첫 줄).
    pub subject: String,
}

// ─── sync 구현 (`*_inner`) — 단위 테스트 대상 ───────────────────────────────

fn git_is_repo_inner(vault_path: &str) -> Result<bool, String> {
    let vault = canon_vault(vault_path)?;
    Ok(vault.join(".git").exists()
        && run_git(&vault, &["rev-parse", "--is-inside-work-tree"]).is_ok())
}

fn git_init_inner(vault_path: &str) -> Result<bool, String> {
    let vault = canon_vault(vault_path)?;
    if vault.join(".git").exists() {
        return Ok(false); // 기존 repo(중첩 가능성) — 건드리지 않음
    }
    run_git(&vault, &["init"])?;
    let gi = vault.join(".gitignore");
    if !gi.exists() {
        std::fs::write(&gi, GITIGNORE).map_err(|e| format!(".gitignore 쓰기 실패: {e}"))?;
    }
    commit_inner(&vault, "Lapis: 버전관리 시작 (초기 스냅샷)")?;
    Ok(true)
}

fn git_has_changes_inner(vault_path: &str) -> Result<bool, String> {
    let vault = canon_vault(vault_path)?;
    let out = run_git(&vault, &["status", "--porcelain"])?;
    Ok(!out.trim().is_empty())
}

fn git_commit_all_inner(vault_path: &str, message: &str) -> Result<bool, String> {
    let vault = canon_vault(vault_path)?;
    commit_inner(&vault, message)
}

/// add -A → (스테이징 변경 있으면) commit. 빈 커밋 방지. user 식별자 인라인 지정.
fn commit_inner(vault: &Path, message: &str) -> Result<bool, String> {
    run_git(vault, &["add", "-A"])?;
    // diff --cached --quiet: 스테이징 변경 없으면 exit 0(Ok) → 커밋 skip.
    if run_git(vault, &["diff", "--cached", "--quiet"]).is_ok() {
        return Ok(false);
    }
    run_git(
        vault,
        &[
            "-c",
            "user.name=Lapis",
            "-c",
            "user.email=lapis@local",
            "commit",
            "-m",
            message,
        ],
    )?;
    Ok(true)
}

fn git_log_inner(vault_path: &str, path: &str, limit: u32) -> Result<Vec<GitCommit>, String> {
    let vault = canon_vault(vault_path)?;
    let rel = rel_in_vault(&vault, path)?;
    // 필드 구분 = git의 %x1f(출력에서 0x1F 바이트). 포맷 문자열 자체는 출력가능 ASCII만.
    let n = format!("-n{}", limit.clamp(1, 500));
    let out = run_git(
        &vault,
        &[
            "log",
            "--follow",
            &n,
            "--pretty=format:%H%x1f%h%x1f%an%x1f%at%x1f%s",
            "--",
            &rel,
        ],
    )?;
    let fs = char::from(0x1f); // 런타임 생성 — 소스에 제어문자 두지 않음
    let mut commits = Vec::new();
    for line in out.lines() {
        if line.is_empty() {
            continue;
        }
        let f: Vec<&str> = line.split(fs).collect();
        if f.len() < 5 {
            continue;
        }
        commits.push(GitCommit {
            hash: f[0].to_string(),
            short: f[1].to_string(),
            author: f[2].to_string(),
            timestamp: f[3].parse().unwrap_or(0),
            subject: f[4].to_string(),
        });
    }
    Ok(commits)
}

fn git_show_diff_inner(vault_path: &str, path: &str, rev: &str) -> Result<String, String> {
    let vault = canon_vault(vault_path)?;
    let rel = rel_in_vault(&vault, path)?;
    if rev.is_empty() || !rev.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("잘못된 rev (hash가 아님)".to_string());
    }
    run_git(&vault, &["show", rev, "--", &rel])
}

// ─── Tauri commands — async + spawn_blocking(IPC 스레드 비점유) ──────────────

/// vault가 git work tree인가.
#[tauri::command]
pub async fn git_is_repo(vault_path: String) -> Result<bool, String> {
    spawn_blocking(move || git_is_repo_inner(&vault_path))
        .await
        .map_err(|e| format!("git_is_repo spawn_blocking join: {e}"))?
}

/// vault에 git 초기화(+`.gitignore`, 초기 커밋). 이미 repo면 false.
#[tauri::command]
pub async fn git_init(vault_path: String) -> Result<bool, String> {
    spawn_blocking(move || git_init_inner(&vault_path))
        .await
        .map_err(|e| format!("git_init spawn_blocking join: {e}"))?
}

/// 커밋할 변경(gitignore 반영)이 있는가.
#[tauri::command]
pub async fn git_has_changes(vault_path: String) -> Result<bool, String> {
    spawn_blocking(move || git_has_changes_inner(&vault_path))
        .await
        .map_err(|e| format!("git_has_changes spawn_blocking join: {e}"))?
}

/// 전체 변경 add -A 후 커밋. 변경 없으면 false.
#[tauri::command]
pub async fn git_commit_all(vault_path: String, message: String) -> Result<bool, String> {
    spawn_blocking(move || git_commit_all_inner(&vault_path, &message))
        .await
        .map_err(|e| format!("git_commit_all spawn_blocking join: {e}"))?
}

/// 노트 1건의 commit 이력(최신순, `--follow`). limit는 1~500 clamp.
#[tauri::command]
pub async fn git_log(vault_path: String, path: String, limit: u32) -> Result<Vec<GitCommit>, String> {
    spawn_blocking(move || git_log_inner(&vault_path, &path, limit))
        .await
        .map_err(|e| format!("git_log spawn_blocking join: {e}"))?
}

/// 특정 commit에서 그 노트의 diff. rev는 16진 hash만 허용.
#[tauri::command]
pub async fn git_show_diff(vault_path: String, path: String, rev: String) -> Result<String, String> {
    spawn_blocking(move || git_show_diff_inner(&vault_path, &path, &rev))
        .await
        .map_err(|e| format!("git_show_diff spawn_blocking join: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    /// 고유 임시 디렉토리. macOS `as_nanos()`는 마이크로초 해상도라 병렬 테스트가 같은 값을
    /// 받을 수 있어, 프로세스 내 단조 증가 카운터를 더해 충돌(같은 dir에 git init 경합)을 막는다.
    static SEQ: AtomicU64 = AtomicU64::new(0);
    fn temp_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        let mut p = std::env::temp_dir();
        p.push(format!("lapis-git-test-{}-{}-{}", std::process::id(), nanos, seq));
        fs::create_dir_all(&p).unwrap();
        // canonicalize로 /var→/private/var 등 정규화(우리 함수가 canonicalize하므로 일치 필요).
        p.canonicalize().unwrap()
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().to_string()
    }

    #[test]
    fn init_creates_repo_and_initial_commit() {
        let dir = temp_dir();
        fs::write(dir.join("a.md"), "# A\n").unwrap();

        assert!(!git_is_repo_inner(&s(&dir)).unwrap());
        assert!(git_init_inner(&s(&dir)).unwrap()); // 새로 생성 → true
        assert!(git_is_repo_inner(&s(&dir)).unwrap());
        assert!(dir.join(".gitignore").exists());
        // 두 번째 init은 no-op
        assert!(!git_init_inner(&s(&dir)).unwrap());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn commit_detects_and_records_changes() {
        let dir = temp_dir();
        let note = dir.join("note.md");
        fs::write(&note, "v1\n").unwrap();
        git_init_inner(&s(&dir)).unwrap();

        // 초기 커밋 직후 — 변경 없음
        assert!(!git_has_changes_inner(&s(&dir)).unwrap());

        // 수정 → 변경 감지 → 커밋 → 다시 깨끗
        fs::write(&note, "v2\n").unwrap();
        assert!(git_has_changes_inner(&s(&dir)).unwrap());
        assert!(git_commit_all_inner(&s(&dir), "edit").unwrap()); // 커밋함 → true
        assert!(!git_has_changes_inner(&s(&dir)).unwrap());
        // 변경 없는데 커밋 시도 → false(빈 커밋 방지)
        assert!(!git_commit_all_inner(&s(&dir), "noop").unwrap());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn log_returns_history_for_note() {
        let dir = temp_dir();
        let note = dir.join("note.md");
        fs::write(&note, "v1\n").unwrap();
        git_init_inner(&s(&dir)).unwrap();
        fs::write(&note, "v2\n").unwrap();
        git_commit_all_inner(&s(&dir), "second").unwrap();

        let log = git_log_inner(&s(&dir), &s(&note), 10).unwrap();
        assert_eq!(log.len(), 2); // 초기 + second
        assert_eq!(log[0].subject, "second"); // 최신순
        assert!(log[0].timestamp > 0);
        assert!(!log[0].short.is_empty());

        // diff(최신 commit) — 노트 내용 변화 포함
        let diff = git_show_diff_inner(&s(&dir), &s(&note), &log[0].hash).unwrap();
        assert!(diff.contains("v2"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn memories_folder_is_ignored() {
        let dir = temp_dir();
        fs::write(dir.join("real.md"), "x\n").unwrap();
        git_init_inner(&s(&dir)).unwrap();
        assert!(!git_has_changes_inner(&s(&dir)).unwrap());

        // _memories 안 파일은 gitignore → 변경으로 안 잡힘
        fs::create_dir_all(dir.join("_memories")).unwrap();
        fs::write(dir.join("_memories/m.md"), "noise\n").unwrap();
        assert!(!git_has_changes_inner(&s(&dir)).unwrap());

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn show_diff_rejects_non_hex_rev() {
        let dir = temp_dir();
        let note = dir.join("n.md");
        fs::write(&note, "x\n").unwrap();
        git_init_inner(&s(&dir)).unwrap();
        assert!(git_show_diff_inner(&s(&dir), &s(&note), "HEAD; rm -rf").is_err());

        fs::remove_dir_all(&dir).ok();
    }
}
