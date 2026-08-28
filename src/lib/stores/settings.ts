import { writable } from "svelte/store";
import { DEFAULT_THEME_ID, findTheme } from "$lib/colorThemes";
import { settingsRead, settingsWrite, type LapisSettings } from "$lib/tauri/settings";
import { logWarn } from "$lib/stores/usage";

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
export const colorTheme = writable<string>(DEFAULT_THEME_ID);
export const customCss = writable<string>(CUSTOM_CSS_DEFAULT);
/** 사용자 CSS 적용 여부. 패닉 단축키가 이걸 끈다. */
export const customCssEnabled = writable<boolean>(true);

export const SETTINGS_DEFAULTS: LapisSettings = {
  link_rewrite_backup_keep: LINK_REWRITE_BACKUP_KEEP_DEFAULT,
  mcp_enabled: MCP_ENABLED_DEFAULT,
  custom_css: CUSTOM_CSS_DEFAULT,
  custom_css_enabled: true,
  color_theme: DEFAULT_THEME_ID,
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

/**
 * 부분 갱신 → 전체 객체로 병합해 저장. 설정을 쓰는 유일한 경로.
 *
 * ## ⚠️ 쓰고 나서 **다시 읽어 확인한다**
 *
 * 예전에는 `settingsWrite` 가 던지지 않으면 성공으로 봤다. 그런데 "MCP 질의를 켰는데
 * 파일이 안 바뀌었다"가 실제로 났고, 화면은 켜진 것으로 보였다 — 되돌아온 것이 없으니
 * 앱이 알 방법이 없었다.
 *
 * 쓰기가 **다른 파일에 성공**하는 경우가 있다(dev/릴리즈 분기). 그건 예외가 아니라
 * 정상 종료라서, 확인은 예외 처리가 아니라 **읽어 보는 것**으로만 된다.
 *
 * ⚠️ 다시 읽는 비용은 설정 저장 때 한 번이다. 이 경로는 사람이 클릭할 때만 돈다.
 */
async function patchSettings(partial: Partial<LapisSettings>): Promise<void> {
  const next = mergeSettings(snapshot, partial);
  await settingsWrite(next);

  const after = await settingsRead();
  const missed = (Object.keys(partial) as (keyof LapisSettings)[]).filter(
    (k) => after[k] !== next[k],
  );
  if (missed.length > 0) {
    // ⚠️ store 를 갱신하지 않는다. 갱신하면 화면만 바뀌고 디스크는 그대로인,
    //    바로 그 상태가 된다.
    throw new Error(
      `설정이 저장되지 않았다: ${missed.join(", ")} — 쓴 뒤 다시 읽으니 값이 달랐다`,
    );
  }
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
    // 모르는 id(옛 설정·손편집)는 기본으로 떨어뜨린다. 목록은 프런트가 진실이다.
    const theme = findTheme(s.color_theme) ? s.color_theme : DEFAULT_THEME_ID;
    snapshot = {
      link_rewrite_backup_keep: keep,
      mcp_enabled: mcp,
      custom_css: css,
      custom_css_enabled: cssOn,
      color_theme: theme,
    };
    linkRewriteBackupKeep.set(keep);
    mcpEnabled.set(mcp);
    customCss.set(css);
    customCssEnabled.set(cssOn);
    colorTheme.set(theme);
  } catch (e) {
    logWarn("stores/settings", "[settings] restore 실패 → 기본값 유지", e);
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
    logWarn("stores/settings", "[settings] 사용자 CSS 토글 저장 실패", e);
  }
}

/**
 * 있으면 View Transition 으로 감싸고, 없으면 그냥 부른다.
 *
 * 반환값을 안 기다린다 — 저장(`patchSettings`)이 애니메이션 끝을 기다릴 이유가 없다.
 */
function startViewTransition(apply: () => void): void {
  const d = typeof document === "undefined" ? null : (document as Document & {
    startViewTransition?: (cb: () => void) => unknown;
  });
  if (!d?.startViewTransition) {
    apply();
    return;
  }
  d.startViewTransition(apply);
}

/** 색 테마 프리셋 적용 — 백엔드 JSON + store. */
export async function applyColorTheme(id: string): Promise<void> {
  const safe = findTheme(id) ? id : DEFAULT_THEME_ID;
  // `setCustomCssEnabled`와 같은 순서 — store를 먼저 세워 화면이 바로 따라오게 하고,
  // 저장은 뒤에 한다. 색을 고르는 조작은 즉시 보이는 것이 전부다.
  //
  // ⚠️ **토큰에 `transition` 을 걸지 않는다.** 151곳에 걸면 hover 하나에도 색이 늦게
  //    따라오고, WKWebView 에서 프레임이 떨어진다. 대신 브라우저가 뜬 **스냅샷 한 장**을
  //    크로스페이드한다 — 리페인트는 한 번, 애니메이션 대상은 요소 하나다.
  //
  // ⚠️ `startViewTransition` 이 없는 환경(구형 WebView·테스트)에서는 그냥 즉시 바뀐다.
  //    여기서 없다고 던지면 색을 아예 못 고르게 된다.
  startViewTransition(() => colorTheme.set(safe));
  try {
    await patchSettings({ color_theme: safe });
  } catch (e) {
    // ⚠️ 호출부가 `void applyColorTheme(...)`로 부른다. 여기서 안 잡으면 unhandled
    //    rejection이 된다. 저장에 실패해도 이번 세션의 화면은 이미 바뀌었고, 다음 기동에
    //    옛 테마로 돌아갈 뿐이다 — 색 하나 때문에 콘솔을 어지럽힐 이유가 없다.
    logWarn("stores/settings", "[settings] 색 테마 저장 실패", e);
  }
}
