import { invoke } from "@tauri-apps/api/core";

export interface LapisSettings {
  claude_mem_enabled: boolean;
  pending_cleanup: boolean;
}

export async function settingsRead(): Promise<LapisSettings> {
  return await invoke<LapisSettings>("settings_read");
}

export async function settingsWrite(next: LapisSettings): Promise<void> {
  await invoke("settings_write", { next });
}

export async function appRestart(): Promise<void> {
  await invoke("app_restart");
}
