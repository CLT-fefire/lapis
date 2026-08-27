import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 설정 쓰기가 **정말 디스크에 닿았는지** 확인한다.
 *
 * ## ⚠️ 왜 이 검사가 생겼나
 *
 * v2.4.0을 설치하고 앱에서 "MCP 질의 → 허용"을 눌렀는데 `lapis-settings.json` 의
 * `mcp_enabled` 가 `false` 그대로였다. **화면은 켜진 것으로 보였고 실패 힌트도 안 떴다.**
 * 그러면 원인을 앱이 아니라 MCP 쪽에서 찾게 된다 — 실제로 그렇게 헤맸다.
 *
 * 쓰기가 **다른 파일에 성공**하는 경우가 있어서(dev/릴리즈 분기) 예외로는 못 잡는다.
 * 정상 종료이기 때문이다. 확인은 **다시 읽어 보는 것**으로만 된다.
 */

const state = {
  disk: {
    link_rewrite_backup_keep: 20,
    mcp_enabled: false,
    custom_css: "",
    custom_css_enabled: true,
    color_theme: "",
  } as Record<string, unknown>,
  /** true 면 쓰기가 **성공한 척만** 한다 — 다른 파일에 쓴 상황을 흉내낸다. */
  swallow: false,
};

vi.mock("$lib/tauri/settings", () => ({
  settingsRead: async () => ({ ...state.disk }),
  settingsWrite: async (next: Record<string, unknown>) => {
    if (state.swallow) return;
    state.disk = { ...next };
  },
  settingsPaths: async () => ({ writes: "/a", mcp_reads: "/a", same: true }),
}));

const { applyMcpEnabled, restoreSettings, mcpEnabled } = await import("./stores/settings");

beforeEach(async () => {
  state.swallow = false;
  state.disk = {
    link_rewrite_backup_keep: 20,
    mcp_enabled: false,
    custom_css: "",
    custom_css_enabled: true,
    color_theme: "",
  };
  await restoreSettings();
});

const read = () => state.disk.mcp_enabled;
const store = () => {
  let v: boolean | undefined;
  mcpEnabled.subscribe((x) => (v = x))();
  return v;
};

describe("쓰기가 실제로 닿았는지 확인한다", () => {
  it("보통은 그냥 저장된다", async () => {
    await applyMcpEnabled(true);
    expect(read()).toBe(true);
    expect(store()).toBe(true);
  });

  /**
   * ⚠️ **이게 핵심이다.** 쓰기가 던지지 않고 값도 안 바뀌는 상황 — 다른 파일에 썼거나,
   * 무언가가 되돌렸거나. 예전에는 여기서 성공이라고 했다.
   */
  it("쓴 값이 안 남아 있으면 던진다", async () => {
    state.swallow = true;
    await expect(applyMcpEnabled(true)).rejects.toThrow(/저장되지 않았다/);
  });

  /** ⚠️ 던지면서 store 를 갱신하면 **화면만 바뀌고 디스크는 그대로**다. 그 상태가 원래 문제였다. */
  it("실패했을 때 store 를 갱신하지 않는다", async () => {
    state.swallow = true;
    await applyMcpEnabled(true).catch(() => {});
    expect(store()).toBe(false);
  });

  it("어느 키가 안 남았는지 말한다", async () => {
    state.swallow = true;
    await expect(applyMcpEnabled(true)).rejects.toThrow(/mcp_enabled/);
  });
});

describe("⚠️ 같은 값을 다시 써도 막지 않는다", () => {
  /**
   * 예전 `setMcp` 는 `if ($mcpEnabled === v) return;` 로 걸렀다. store 와 디스크가
   * 어긋나면 **되돌릴 유일한 조작이 아무 일도 안 하고 아무 말도 안 했다.**
   */
  it("이미 켜져 있어도 쓰기가 돈다", async () => {
    await applyMcpEnabled(true);
    state.disk.mcp_enabled = false; // 밖에서 어긋나게 만든다
    await applyMcpEnabled(true);
    expect(read()).toBe(true);
  });
});

describe("⚠️ 화면 쪽 배선", () => {
  /**
   * store 테스트는 컴포넌트를 안 지난다 — 가드를 되돌려도 위 다섯 건이 전부 통과한다.
   * 실제로 카나리아로 확인했다. 그래서 소스를 읽는다.
   */
  const SRC = readFileSync(
    fileURLToPath(new URL("./SettingsModal.svelte", import.meta.url)),
    "utf-8",
  ).replace(/^[ \t]*\/\/.*$/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");

  it("소스를 실제로 읽었다", () => {
    expect(SRC).toContain("function setMcp");
  });

  /** ⚠️ 같은 값이라고 조기 반환하면 되돌릴 유일한 조작이 아무 일도 안 한다. */
  it("setMcp 가 같은 값에서 조기 반환하지 않는다", () => {
    const i = SRC.indexOf("function setMcp");
    const fn = SRC.slice(i, SRC.indexOf(NL + "  }", i));
    expect(fn).not.toMatch(/=== v\)\s*return/);
    expect(fn).toContain("applyMcpEnabled(v)");
  });

  /** 갈린 경로는 힌트가 아니라 경고다 — 화면에 띄우지 않으면 P2 가 그대로다. */
  it("MCP 가 읽는 경로를 화면에 띄운다", () => {
    expect(SRC).toContain("settingsPaths()");
    expect(SRC).toContain("settings_mcp_paths_split");
  });
});

const NL = String.fromCharCode(10);
