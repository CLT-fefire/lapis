import { writable } from "svelte/store";
import { settingsRead, settingsWrite } from "$lib/tauri/settings";

// 백엔드 `lapis-settings.json`이 단일 SOT. localStorage 사용 안 함.
export const settingsOpen = writable<boolean>(false);

/** 노트 이름 변경 시 백업 스냅샷 최대 보존 개수 (vault.ts의 prune이 참조). 기본 20, range 1-100. */
export const LINK_REWRITE_BACKUP_KEEP_MIN = 1;
export const LINK_REWRITE_BACKUP_KEEP_MAX = 100;
export const LINK_REWRITE_BACKUP_KEEP_DEFAULT = 20;
export const linkRewriteBackupKeep = writable<number>(LINK_REWRITE_BACKUP_KEEP_DEFAULT);

export function clampBackupKeep(n: number): number {
  if (!Number.isFinite(n)) return LINK_REWRITE_BACKUP_KEEP_DEFAULT;
  return Math.max(
    LINK_REWRITE_BACKUP_KEEP_MIN,
    Math.min(LINK_REWRITE_BACKUP_KEEP_MAX, Math.floor(n)),
  );
}

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
    linkRewriteBackupKeep.set(clampBackupKeep(s.link_rewrite_backup_keep));
  } catch (e) {
    console.warn("[settings] restore 실패 → 기본값 유지", e);
  } finally {
    settingsLoaded.set(true);
  }
}

/** 백업 max_keep 적용 — clamp 후 백엔드에 저장 + store 갱신. */
export async function applyBackupKeep(n: number): Promise<number> {
  const clamped = clampBackupKeep(n);
  await settingsWrite({
    link_rewrite_backup_keep: clamped,
  });
  linkRewriteBackupKeep.set(clamped);
  return clamped;
}
