import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

// 백엔드 IPC는 테스트에서 못 탄다 — invoke 경계만 갈아끼우고 병합 로직을 검증한다.
vi.mock("$lib/tauri/settings", () => ({
  settingsRead: vi.fn(),
  settingsWrite: vi.fn(),
}));

import { settingsRead, settingsWrite, type LapisSettings } from "$lib/tauri/settings";
import {
  mergeSettings,
  clampBackupKeep,
  restoreSettings,
  applyBackupKeep,
  applyMcpEnabled,
  linkRewriteBackupKeep,
  mcpEnabled,
  SETTINGS_DEFAULTS,
  LINK_REWRITE_BACKUP_KEEP_MIN,
  LINK_REWRITE_BACKUP_KEEP_MAX,
  LINK_REWRITE_BACKUP_KEEP_DEFAULT,
} from "./settings";

const read = vi.mocked(settingsRead);
const write = vi.mocked(settingsWrite);

beforeEach(() => {
  vi.clearAllMocks();
  write.mockResolvedValue(undefined);
});

describe("SETTINGS_DEFAULTS", () => {
  it("MCP 질의는 기본 꺼짐", () => {
    expect(SETTINGS_DEFAULTS.mcp_enabled).toBe(false);
  });
});

/**
 * 픽스처를 `SETTINGS_DEFAULTS` 위에 얹는다.
 *
 * ⚠️ 예전엔 필드를 손으로 나열했다. 그러면 **설정에 필드가 늘 때마다 픽스처를 고쳐야
 * 하고**, 고치는 김에 새 필드를 단언에서 빠뜨리기 쉽다 — 이 테스트가 막으려는 결함이
 * 정확히 "부분 갱신이 다른 필드를 날리는 것"이라 새 필드일수록 중요하다.
 * 기본값에서 파생하면 새 필드가 **자동으로 검사 대상**이 된다.
 */
const at = (o: Partial<LapisSettings>): LapisSettings => ({ ...SETTINGS_DEFAULTS, ...o });

describe("mergeSettings", () => {
  it("부분 갱신이 나머지 필드를 보존한다", () => {
    const current = at({ link_rewrite_backup_keep: 50, mcp_enabled: true });
    expect(mergeSettings(current, { link_rewrite_backup_keep: 30 })).toEqual(
      at({ link_rewrite_backup_keep: 30, mcp_enabled: true }),
    );
    expect(mergeSettings(current, { mcp_enabled: false })).toEqual(
      at({ link_rewrite_backup_keep: 50, mcp_enabled: false }),
    );
  });

  /** 새로 생긴 필드도 같은 보장을 받는지 — 위 헬퍼 덕분에 여기만 더하면 된다. */
  it("사용자 CSS 도 부분 갱신에서 보존된다", () => {
    const current = at({ custom_css: ".x{}", custom_css_enabled: true });
    expect(mergeSettings(current, { mcp_enabled: true }).custom_css).toBe(".x{}");
    expect(mergeSettings(current, { custom_css: ".y{}" }).custom_css_enabled).toBe(true);
  });

  it("빈 patch는 현재 값 그대로", () => {
    const current = at({ link_rewrite_backup_keep: 7, mcp_enabled: true });
    expect(mergeSettings(current, {})).toEqual(current);
  });
});

// ⚠️ 회귀 방지 — 예전 `applyBackupKeep`은 자기 필드만 담은 리터럴을 보냈다. 필드가
// 하나뿐이라 무해했지만 `mcp_enabled` 추가 시점부터는 **백업 개수를 바꿀 때마다
// MCP가 조용히 꺼진다**(Rust `#[serde(default)]`가 누락 필드를 false로 채운다).
describe("부분 저장이 다른 필드를 지우지 않는다", () => {
  it("applyBackupKeep이 mcp_enabled를 보존한다", async () => {
    read.mockResolvedValue(at({ link_rewrite_backup_keep: 50, mcp_enabled: true }));
    await restoreSettings();

    await applyBackupKeep(30);

    expect(write).toHaveBeenCalledWith(
      at({ link_rewrite_backup_keep: 30, mcp_enabled: true }),
    );
    expect(get(linkRewriteBackupKeep)).toBe(30);
    expect(get(mcpEnabled)).toBe(true);
  });

  it("applyMcpEnabled가 link_rewrite_backup_keep을 보존한다", async () => {
    read.mockResolvedValue(at({ link_rewrite_backup_keep: 77, mcp_enabled: false }));
    await restoreSettings();

    await applyMcpEnabled(true);

    expect(write).toHaveBeenCalledWith(
      at({ link_rewrite_backup_keep: 77, mcp_enabled: true }),
    );
    expect(get(mcpEnabled)).toBe(true);
    expect(get(linkRewriteBackupKeep)).toBe(77);
  });

  it("연속 저장이 누적된다 — 앞선 patch가 뒤에서 되돌아가지 않는다", async () => {
    read.mockResolvedValue(at({ link_rewrite_backup_keep: 20, mcp_enabled: false }));
    await restoreSettings();

    await applyMcpEnabled(true);
    await applyBackupKeep(5);

    expect(write).toHaveBeenLastCalledWith(
      at({ link_rewrite_backup_keep: 5, mcp_enabled: true }),
    );
  });
});

describe("restoreSettings", () => {
  it("읽은 값을 clamp해서 store에 넣는다", async () => {
    read.mockResolvedValue(at({ link_rewrite_backup_keep: 9999, mcp_enabled: true }));
    await restoreSettings();
    expect(get(linkRewriteBackupKeep)).toBe(LINK_REWRITE_BACKUP_KEEP_MAX);
  });

  it("읽기 실패해도 던지지 않는다", async () => {
    read.mockRejectedValue(new Error("IPC 끊김"));
    await expect(restoreSettings()).resolves.toBeUndefined();
  });

  it("mcp_enabled가 true가 아니면 전부 false로 본다", async () => {
    // 구버전 JSON엔 필드가 없다 — Rust가 false로 채우지만 프론트도 방어한다.
    read.mockResolvedValue({ link_rewrite_backup_keep: 20 } as never);
    await restoreSettings();
    expect(get(mcpEnabled)).toBe(false);
  });
});

describe("clampBackupKeep", () => {
  it("범위 밖은 경계로, 비수치는 기본값", () => {
    expect(clampBackupKeep(0)).toBe(LINK_REWRITE_BACKUP_KEEP_MIN);
    expect(clampBackupKeep(101)).toBe(LINK_REWRITE_BACKUP_KEEP_MAX);
    expect(clampBackupKeep(Number.NaN)).toBe(LINK_REWRITE_BACKUP_KEEP_DEFAULT);
  });
});
