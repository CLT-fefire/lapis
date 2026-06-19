import { invoke } from "@tauri-apps/api/core";

/**
 * vault git 버전관리 IPC 래퍼 (ADR-004). 백엔드 `src-tauri/src/git.rs`(shell-out)와 1:1.
 * 인자명은 camelCase로 호출(Tauri가 snake_case 변환).
 */

export interface GitCommit {
  /** 전체 hash. */
  hash: string;
  /** 짧은 hash(표시용). */
  short: string;
  /** author 이름. */
  author: string;
  /** author 시각(epoch seconds). */
  timestamp: number;
  /** commit 제목(첫 줄). */
  subject: string;
}

/** vault가 git work tree인가. */
export function gitIsRepo(vaultPath: string): Promise<boolean> {
  return invoke<boolean>("git_is_repo", { vaultPath });
}

/** vault에 git 초기화(+.gitignore, 초기 커밋). 이미 repo면 false. */
export function gitInit(vaultPath: string): Promise<boolean> {
  return invoke<boolean>("git_init", { vaultPath });
}

/** 커밋할 변경(gitignore 반영)이 있는가. */
export function gitHasChanges(vaultPath: string): Promise<boolean> {
  return invoke<boolean>("git_has_changes", { vaultPath });
}

/** 전체 변경 add -A 후 커밋. 변경 없으면 false. */
export function gitCommitAll(vaultPath: string, message: string): Promise<boolean> {
  return invoke<boolean>("git_commit_all", { vaultPath, message });
}

/** 변경된 path만 add 후 커밋(거대 vault에서 전체 스캔 회피). 변경 없으면 false. */
export function gitCommitPaths(
  vaultPath: string,
  paths: string[],
  message: string,
): Promise<boolean> {
  return invoke<boolean>("git_commit_paths", { vaultPath, paths, message });
}

/** 노트 1건의 commit 이력(최신순). */
export function gitLog(vaultPath: string, path: string, limit: number): Promise<GitCommit[]> {
  return invoke<GitCommit[]>("git_log", { vaultPath, path, limit });
}

/** 특정 commit에서 그 노트의 diff. */
export function gitShowDiff(vaultPath: string, path: string, rev: string): Promise<string> {
  return invoke<string>("git_show_diff", { vaultPath, path, rev });
}
