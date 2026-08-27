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

export const CUSTOM_CSS_DEFAULT = "";
export const customCss = writable<string>(CUSTOM_CSS_DEFAULT);
/** 사용자 CSS 적용 여부. 패닉 단축키가 이걸 끈다. */
export const customCssEnabled = writable<boolean>(true);

export const SETTINGS_DEFAULTS: LapisSettings = {
  link_rewrite_backup_keep: LINK_REWRITE_BACKUP_KEEP_DEFAULT,
  mcp_enabled: MCP_ENABLED_DEFAULT,
  custom_css: CUSTOM_CSS_DEFAULT,
  custom_css_enabled: true,
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
    const css = typeof s.custom_css === "string" ? s.custom_css : CUSTOM_CSS_DEFAULT;
    // 없는 필드는 켜진 것으로 읽는다 — 예전 설정 파일에는 이 키가 없다.
    const cssOn = s.custom_css_enabled !== false;
    snapshot = {
      link_rewrite_backup_keep: keep,
      mcp_enabled: mcp,
      custom_css: css,
      custom_css_enabled: cssOn,
    };
    linkRewriteBackupKeep.set(keep);
    mcpEnabled.set(mcp);
    customCss.set(css);
    customCssEnabled.set(cssOn);
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

/** 사용자 정의 CSS 저장 — 백엔드 JSON + store. */
export async function applyCustomCss(css: string): Promise<void> {
  await patchSettings({ custom_css: css });
  customCss.set(css);
}

/**
 * 사용자 CSS 적용 on/off.
 *
 * ⚠️ **store를 먼저 세우고 저장은 뒤에 한다.** 화면이 새까매진 상태에서 패닉 단축키를
 * 눌렀는데 저장(IPC)이 늦거나 실패하면, 기다리는 동안 화면이 그대로다. 화면을 되살리는
 * 것이 급하고 영속은 그다음이다.
 */
export async function setCustomCssEnabled(on: boolean): Promise<void> {
  customCssEnabled.set(on);
  try {
    await patchSettings({ custom_css_enabled: on });
  } catch (e) {
    // 저장에 실패해도 화면은 이미 돌아왔다. 다음 기동에 다시 켜질 뿐이다.
    console.warn("[settings] 사용자 CSS 토글 저장 실패", e);
  }
}
