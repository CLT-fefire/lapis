import { writable, get } from "svelte/store";
import { settingsRead, settingsWrite, claudeMemApply } from "$lib/tauri/settings";

// 백엔드 `lapis-settings.json`이 단일 SOT. localStorage 사용 안 함
// (재시작 없이 동적 토글로 전환하면서 stale write 위험을 원천 차단).
export const claudeMemEnabled = writable<boolean>(false);
export const settingsOpen = writable<boolean>(false);

/** 설정 로드가 끝났는지 — 첫 프레임 flash 방지에 사용. */
export const settingsLoaded = writable<boolean>(false);

/**
 * mirror sync_now 진행 중 여부 — 사이드바 파란 펄스 점 indicator에 사용.
 *
 * 백엔드 `mirror-sync-start` 이벤트로도 갱신되지만, 토글 ON 직후 effect가
 * listener를 비동기 등록하는 사이 start 이벤트가 누락되는 race가 있어,
 * `applyClaudeMemToggle(true)`에서 선제적으로 true를 set한다.
 * `mirror-sync-done`/`mirror-sync-error` 이벤트가 다시 false로 clear.
 */
export const mirrorSyncing = writable<boolean>(false);

/** sync 시작 시각 (epoch ms) — tooltip의 "약 N초 경과" 계산용. null이면 syncing 아님. */
export const mirrorSyncStartedAt = writable<number | null>(null);

export function markMirrorSyncStart(): void {
  mirrorSyncing.set(true);
  mirrorSyncStartedAt.set(Date.now());
}

export function markMirrorSyncEnd(): void {
  mirrorSyncing.set(false);
  mirrorSyncStartedAt.set(null);
}

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
  console.log(`[diag][settings] applyClaudeMemToggle 시작 — enabled=${enabled}`);
  const t0 = performance.now();
  await settingsWrite({ claude_mem_enabled: enabled, pending_cleanup: false });
  console.log(`[diag][settings] settingsWrite 완료 · ${(performance.now() - t0).toFixed(0)}ms`);
  // 토글 ON 시 backend의 mirror-sync-start 이벤트가 frontend listener 등록(비동기)보다
  // 먼저 도착하는 race를 차단하기 위해 선제적으로 syncing=true. done/error로 자동 clear.
  if (enabled) markMirrorSyncStart();
  await claudeMemApply(enabled);
  console.log(`[diag][settings] claudeMemApply 완료 · ${(performance.now() - t0).toFixed(0)}ms`);
  claudeMemEnabled.set(enabled);
  console.log(`[diag][settings] store.set(${enabled}) 완료 — 총 ${(performance.now() - t0).toFixed(0)}ms`);
}

export function isClaudeMemEnabled(): boolean {
  return get(claudeMemEnabled);
}
