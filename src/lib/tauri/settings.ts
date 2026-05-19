import { invoke } from "@tauri-apps/api/core";

export interface LapisSettings {
  claude_mem_enabled: boolean;
  pending_cleanup: boolean;
  /** 노트 이름 변경 시 `.lapis/link-rewrite-backup/` 스냅샷 최대 보존 개수. 기본 20, range 1-100. */
  link_rewrite_backup_keep: number;
}

export async function settingsRead(): Promise<LapisSettings> {
  return await invoke<LapisSettings>("settings_read");
}

export async function settingsWrite(next: LapisSettings): Promise<void> {
  await invoke("settings_write", { next });
}

/**
 * claude-mem 통합 옵션을 런타임에 적용한다 (재시작 불필요).
 * 백엔드에서 WAL watch lazy start / cleanup worker spawn / 인덱스 빌드 등을 분기 수행.
 */
export async function claudeMemApply(enabled: boolean): Promise<void> {
  await invoke("claude_mem_apply", { enabled });
}
