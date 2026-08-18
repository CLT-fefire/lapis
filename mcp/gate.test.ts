/**
 * MCP 질의 게이트 — 앱 설정(`lapis-settings.json`)의 `mcp_enabled`를 읽는다.
 *
 * 프로덕션 레이아웃을 그대로 재현한다: 설정은 **앱 데이터 루트**에 있고
 * `search-cache/`는 그 하위다. 게이트가 캐시 디렉터리의 *부모*를 보는지 확인한다.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readMcpGate, mcpDisabledError } from "./cache.ts";

const dirs: string[] = [];

/** 앱 데이터 루트 + search-cache 하위를 만들고 `LAPIS_CACHE_DIR`을 캐시 쪽으로 건다. */
function layout(settings?: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "lapis-gate-"));
  dirs.push(root);
  const cacheDir = path.join(root, "search-cache");
  mkdirSync(cacheDir, { recursive: true });
  if (settings !== undefined) {
    writeFileSync(path.join(root, "lapis-settings.json"), settings);
  }
  process.env.LAPIS_CACHE_DIR = cacheDir;
  return root;
}

afterEach(() => {
  delete process.env.LAPIS_CACHE_DIR;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("readMcpGate", () => {
  it("mcp_enabled=true면 켜짐", () => {
    layout(JSON.stringify({ link_rewrite_backup_keep: 20, mcp_enabled: true }));
    expect(readMcpGate()).toEqual({ enabled: true });
  });

  it("mcp_enabled=false면 꺼짐", () => {
    layout(JSON.stringify({ link_rewrite_backup_keep: 20, mcp_enabled: false }));
    expect(readMcpGate()).toEqual({ enabled: false, reason: "disabled" });
  });

  // 구버전 JSON엔 필드 자체가 없다 — 기본 OFF라 켜면 안 된다.
  it("필드가 없으면 꺼짐", () => {
    layout(JSON.stringify({ link_rewrite_backup_keep: 20 }));
    expect(readMcpGate()).toEqual({ enabled: false, reason: "disabled" });
  });

  it("설정 파일이 없으면 settings_absent", () => {
    layout(); // 캐시 디렉터리만 만들고 설정은 안 쓴다
    expect(readMcpGate()).toEqual({ enabled: false, reason: "settings_absent" });
  });

  // 손상을 "켜짐"으로 읽으면 게이트가 무의미해진다 — 닫힌 쪽으로 실패한다.
  it("JSON이 깨졌으면 꺼짐", () => {
    layout("{ 이건 JSON이 아니다");
    expect(readMcpGate()).toEqual({ enabled: false, reason: "disabled" });
  });

  it("truthy 흉내는 안 통한다 — 명시적 true만 켬", () => {
    layout(JSON.stringify({ mcp_enabled: "true" }));
    expect(readMcpGate()).toEqual({ enabled: false, reason: "disabled" });
  });

  // 설정은 앱 데이터 루트에 있다. 캐시 디렉터리 안에 두면 안 읽혀야 한다.
  it("캐시 디렉터리 내부의 설정은 보지 않는다", () => {
    const root = layout();
    writeFileSync(
      path.join(root, "search-cache", "lapis-settings.json"),
      JSON.stringify({ mcp_enabled: true }),
    );
    expect(readMcpGate()).toEqual({ enabled: false, reason: "settings_absent" });
  });
});

describe("mcpDisabledError", () => {
  it("두 원인의 안내가 갈린다", () => {
    const off = mcpDisabledError({ enabled: false, reason: "disabled" });
    const absent = mcpDisabledError({ enabled: false, reason: "settings_absent" });
    expect(off.kind).toBe("mcp_disabled");
    expect(absent.kind).toBe("mcp_disabled");
    expect(off.message).not.toBe(absent.message);
    expect(absent.remedy).toContain("한 번 실행");
  });

  it("앱 설정으로는 기동을 못 막는다는 것을 remedy가 말해준다", () => {
    const e = mcpDisabledError({ enabled: false, reason: "disabled" });
    expect(e.remedy).toContain("mcpServers.lapis");
    expect(e.toJSON().error.kind).toBe("mcp_disabled");
  });
});
