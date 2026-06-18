import { invoke } from "@tauri-apps/api/core";

export interface LapisSettings {
  /** 노트 이름 변경 시 `.lapis/link-rewrite-backup/` 스냅샷 최대 보존 개수. 기본 20, range 1-100. */
  link_rewrite_backup_keep: number;
}

export async function settingsRead(): Promise<LapisSettings> {
  return await invoke<LapisSettings>("settings_read");
}

export async function settingsWrite(next: LapisSettings): Promise<void> {
  await invoke("settings_write", { next });
}
