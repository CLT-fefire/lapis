import { writable } from "svelte/store";
import { settingsRead, settingsWrite, type LapisSettings } from "$lib/tauri/settings";

// 백엔드 `lapis-settings.json`이 단일 SOT. localStorage 사용 안 함.
export const settingsOpen = writable<boolean>(false);

/** 노트 이름 변경 시 백업 스냅샷 최대 보존 개수 (vault.ts의 prune이 참조). 기본 20, range 1-100. */
export const LINK_REWRITE_BACKUP_KEEP_MIN = 1;
export const LINK_REWRITE_BACKUP_KEEP_MAX = 100;
export const LINK_REWRITE_BACKUP_KEEP_DEFAULT = 20;
export const linkRewriteBackupKeep = writable<number>(LINK_REWRITE_BACKUP_KEEP_DEFAULT);

/**
 * MCP(`lapis_query`) 질의 허용 여부. **기본 꺼짐.**
 *
 * ⚠️ 끈다고 서버 프로세스가 안 뜨는 게 아니다 — `lapis-mcp`는 stdio 서버라
 * MCP 클라이언트가 띄운다. 이 값이 정하는 건 **질의를 받아줄지**뿐이다.
 * 프로세스까지 막으려면 `~/.claude.json`의 `mcpServers.lapis`를 제거해야 한다.
 */
export const MCP_ENABLED_DEFAULT = false;
export const mcpEnabled = writable<boolean>(MCP_ENABLED_DEFAULT);

export const SETTINGS_DEFAULTS: LapisSettings = {
  link_rewrite_backup_keep: LINK_REWRITE_BACKUP_KEEP_DEFAULT,
  mcp_enabled: MCP_ENABLED_DEFAULT,
};

export function clampBackupKeep(n: number): number {
  if (!Number.isFinite(n)) return LINK_REWRITE_BACKUP_KEEP_DEFAULT;
  return Math.max(
    LINK_REWRITE_BACKUP_KEEP_MIN,
    Math.min(LINK_REWRITE_BACKUP_KEEP_MAX, Math.floor(n)),
  );
}

/**
 * 부분 갱신을 현재 스냅샷 위에 병합한다.
 *
 * ⚠️ `settings_write`는 **전체 객체**를 받는다. 호출부가 자기 필드만 담은 리터럴을
 * 넘기면 나머지가 누락되고 Rust의 `#[serde(default)]`가 기본값으로 덮어쓴다 —
 * **에러 없이 남의 설정이 리셋된다.** 필드가 하나뿐이던 시절엔 드러나지 않던 결함이라,
 * `mcp_enabled`를 추가하면서 같이 고쳤다(백업 개수를 바꿀 때마다 MCP가 꺼졌을 것).
 */
export function mergeSettings(
  current: LapisSettings,
  partial: Partial<LapisSettings>,
): LapisSettings {
  return { ...current, ...partial };
}

/** 백엔드 JSON의 현재 스냅샷 — `mergeSettings`의 기준. `restoreSettings`가 채운다. */
let snapshot: LapisSettings = { ...SETTINGS_DEFAULTS };

/** 부분 갱신 → 전체 객체로 병합해 저장. 설정을 쓰는 유일한 경로. */
async function patchSettings(partial: Partial<LapisSettings>): Promise<void> {
  const next = mergeSettings(snapshot, partial);
  await settingsWrite(next);
  snapshot = next;
}

/** 설정 로드가 끝났는지 — 첫 프레임 flash 방지에 사용. */
export const settingsLoaded = writable<boolean>(false);

export function openSettings(): void {
  settingsOpen.set(true);
}

export function closeSettings(): void {
  settingsOpen.set(false);
}

/** 시동 시 1회 호출 — 백엔드 JSON에서 설정을 읽어 store와 스냅샷에 반영. */
export async function restoreSettings(): Promise<void> {
  try {
    const s = await settingsRead();
    const keep = clampBackupKeep(s.link_rewrite_backup_keep);
    const mcp = s.mcp_enabled === true;
    snapshot = { link_rewrite_backup_keep: keep, mcp_enabled: mcp };
    linkRewriteBackupKeep.set(keep);
    mcpEnabled.set(mcp);
  } catch (e) {
    console.warn("[settings] restore 실패 → 기본값 유지", e);
  } finally {
    settingsLoaded.set(true);
  }
}

/** 백업 max_keep 적용 — clamp 후 백엔드에 저장 + store 갱신. */
export async function applyBackupKeep(n: number): Promise<number> {
  const clamped = clampBackupKeep(n);
  await patchSettings({ link_rewrite_backup_keep: clamped });
  linkRewriteBackupKeep.set(clamped);
  return clamped;
}

/** MCP 질의 허용 여부 적용 — 백엔드에 저장 + store 갱신. */
export async function applyMcpEnabled(v: boolean): Promise<void> {
  await patchSettings({ mcp_enabled: v });
  mcpEnabled.set(v);
}
