import { writable, get } from "svelte/store";
import { settingsWrite, type LapisSettings } from "$lib/tauri/settings";

const CLAUDE_MEM_KEY = "lapis.settings.claudeMemEnabled";

export const claudeMemEnabled = writable<boolean>(false);
export const settingsOpen = writable<boolean>(false);

export function openSettings(): void {
  settingsOpen.set(true);
}

export function closeSettings(): void {
  settingsOpen.set(false);
}

export function restoreSettings(): void {
  if (typeof localStorage === "undefined") return;
  const raw = localStorage.getItem(CLAUDE_MEM_KEY);
  if (raw === "1" || raw === "true") {
    claudeMemEnabled.set(true);
  }
}

function persistClaudeMem(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CLAUDE_MEM_KEY, enabled ? "1" : "0");
}

export async function setClaudeMemEnabled(
  enabled: boolean,
  pendingCleanup: boolean,
): Promise<void> {
  const next: LapisSettings = {
    claude_mem_enabled: enabled,
    pending_cleanup: pendingCleanup,
  };
  await settingsWrite(next);
  claudeMemEnabled.set(enabled);
  persistClaudeMem(enabled);
}

export function isClaudeMemEnabled(): boolean {
  return get(claudeMemEnabled);
}
