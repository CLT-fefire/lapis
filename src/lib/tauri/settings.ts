import { invoke } from "@tauri-apps/api/core";

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
