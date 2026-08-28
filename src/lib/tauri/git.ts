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

/**
 * 한 커밋 시점의 노트 내용.
 *
 * ⚠️ **파일을 되돌리지 않는다.** `git checkout` 은 작업 트리를 바꾸는 되돌릴 수 없는
 * 쓰기이고, `README` 가 "쓰기 도구가 아니다"라고 못 박았다. 옛 내용을 **읽어서** 주고,
 * 무엇으로 돌아가는지 보고 나서 사용자가 스스로 붙여넣는다.
 */
export function gitShowFile(vaultPath: string, sha: string, path: string): Promise<string> {
  return invoke<string>("git_show_file", { vaultPath, sha, path });
}

/**
 * vault 전체의 최근 커밋 — "오늘 뭐가 바뀌었나".
 *
 * ⚠️ `gitLog`(노트별 이력)와 **다른 질문**이다. 저쪽은 한 노트를 `--follow` 로 따라가고
 * 이쪽은 하루를 조망한다.
 */
export function gitRecent(vaultPath: string, limit = 20): Promise<GitCommit[]> {
  return invoke<GitCommit[]>("git_recent", { vaultPath, limit });
}
