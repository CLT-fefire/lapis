import { writable, get } from "svelte/store";
import { settingsRead, settingsWrite, claudeMemApply } from "$lib/tauri/settings";

// 백엔드 `lapis-settings.json`이 단일 SOT. localStorage 사용 안 함
// (재시작 없이 동적 토글로 전환하면서 stale write 위험을 원천 차단).
export const claudeMemEnabled = writable<boolean>(false);
export const settingsOpen = writable<boolean>(false);

/** 설정 로드가 끝났는지 — 첫 프레임 flash 방지에 사용. */
export const settingsLoaded = writable<boolean>(false);

export function openSettings(): void {
  settingsOpen.set(true);
}

export function closeSettings(): void {
  settingsOpen.set(false);
}

/** 시동 시 1회 호출 — 백엔드 JSON에서 설정을 읽어 store에 반영. */
export async function restoreSettings(): Promise<void> {
  try {
    const s = await settingsRead();
    claudeMemEnabled.set(s.claude_mem_enabled);
  } catch (e) {
    console.warn("[settings] restore 실패 → 기본값 유지", e);
  } finally {
    settingsLoaded.set(true);
  }
}

/**
 * 토글 적용 — 백엔드 JSON에 저장 + 동적 apply command 호출 + store 갱신.
 * 순서: settingsWrite → claudeMemApply → store.set
 *   (백엔드가 정상 반영된 뒤에 UI를 갱신해 일관성 확보)
 */
export async function applyClaudeMemToggle(enabled: boolean): Promise<void> {
  await settingsWrite({ claude_mem_enabled: enabled, pending_cleanup: false });
  await claudeMemApply(enabled);
  claudeMemEnabled.set(enabled);
}

export function isClaudeMemEnabled(): boolean {
  return get(claudeMemEnabled);
}
