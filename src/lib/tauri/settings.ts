import { invoke } from "$lib/tauri/invoke";

export interface LapisSettings {
  /** 노트 이름 변경 시 `.lapis/link-rewrite-backup/` 스냅샷 최대 보존 개수. 기본 20, range 1-100. */
  link_rewrite_backup_keep: number;
  /**
   * MCP(`lapis_query`) 질의 허용 여부. **기본 false** — 명시적으로 켜야 동작한다.
   *
   * ⚠️ 서버 **프로세스 기동**은 이 값과 무관하다. `lapis-mcp`는 stdio 서버라
   * MCP 클라이언트(Claude Code/Desktop)가 띄운다. 이 값은 "질의를 받아줄지"만 정한다.
   */
  mcp_enabled: boolean;
  /**
   * 사용자 정의 CSS. 앱이 `<style data-lapis="user-css">`로 head 끝에 넣는다.
   *
   * ⚠️ localStorage가 아니라 **백엔드 JSON**에 있는 것이 안전장치다. 화면을 못 쓰게
   * 만드는 CSS를 쓰면 앱 안에서는 되돌릴 수 없는데, 파일이면 `lapis css --off`가
   * 고치거나 지우면 초기화된다.
   */
  custom_css: string;
  /** 적용 여부. 기본 true. 패닉 단축키가 이걸 끈다. */
  custom_css_enabled: boolean;
  /** 색 테마 프리셋 id. 빈 값이면 기본(`app.css` 그대로). */
  color_theme: string;
}

export async function settingsRead(): Promise<LapisSettings> {
  return await invoke<LapisSettings>("settings_read");
}

/**
 * ⚠️ **전체 객체**를 받는다. 부분 객체를 넘기면 누락된 필드가 Rust의
 * `#[serde(default)]`로 덮어써진다 — `stores/settings.ts`의 `patchSettings`를 쓸 것.
 */
export async function settingsWrite(next: LapisSettings): Promise<void> {
  await invoke("settings_write", { next });
}

/**
 * 설정 파일이 **어디에 있고 MCP는 어디를 보는지**.
 *
 * ⚠️ dev 빌드에서 "MCP 질의"를 켜면 `-dev` 파일만 바뀌는데 MCP 게이트는 **릴리즈를
 * 먼저** 본다. 그러면 "앱에선 켰는데 MCP는 꺼져 있다"가 되고, 결함이 아닌데 결함과
 * 구분이 안 된다. 화면이 두 경로를 나란히 보여주려고 있다.
 */
export interface SettingsPaths {
  /** 이 빌드가 쓰는 파일. */
  writes: string;
  /** MCP 게이트가 읽을 파일 — 릴리즈 우선. */
  mcp_reads: string;
  same: boolean;
}

export function settingsPaths(): Promise<SettingsPaths> {
  return invoke<SettingsPaths>("settings_paths");
}
