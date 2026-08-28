import { describe, it, expect, beforeEach, vi } from "vitest";
import { get } from "svelte/store";

/**
 * 사용 로그의 **버퍼와 flush**.
 *
 * ## ⚠️ 관찰이 대상을 죽이면 안 된다
 *
 * 이건 관찰 장치다. 로그를 못 써서 저장이 실패하거나 명령이 안 도는 일은 **절대** 없어야
 * 한다. 특히 `logError` 가 던지면 **오류 처리 중에 오류가 나서** 원래 오류가 사라진다.
 */

const invoke = vi.fn<(cmd: string, args: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (c: string, a: unknown) => invoke(c, a) }));

const {
  usageEnabled,
  usageDropped,
  logCommand,
  logError,
  logWarn,
  logSessionStart,
  flushUsage,
  resetUsageBuffer,
  peekUsageBuffer,
} = await import("./usage");

beforeEach(() => {
  localStorage.clear();
  resetUsageBuffer();
  usageEnabled.set(true);
  invoke.mockReset();
  invoke.mockResolvedValue({ written: 0, dropped: 0 });
});

describe("기록", () => {
  it("명령이 입구와 함께 버퍼에 든다", () => {
    logCommand("quick-open", "keymap");
    const e = JSON.parse(peekUsageBuffer()[0]);
    expect(e).toMatchObject({ k: "cmd", id: "quick-open", via: "keymap" });
    expect(typeof e.t).toBe("number");
  });

  it("오류가 자리·메시지·예외를 든다", () => {
    logError("stores/vault", "readNote 실패", new Error("EACCES"));
    const e = JSON.parse(peekUsageBuffer()[0]);
    expect(e).toMatchObject({ k: "err", at: "stores/vault", msg: "readNote 실패" });
    expect(e.detail).toContain("EACCES");
  });

  /** ⚠️ 원래 `console.error` 형태가 둘이었다 — `(msg, e)` 와 `(msg, path, e)`. */
  it("경로가 따로 들어와도 가른다", () => {
    logError("stores/vault", "실패", "/v/a.md", new Error("boom"));
    const e = JSON.parse(peekUsageBuffer()[0]);
    expect(e.path).toBe("/v/a.md");
    expect(e.detail).toContain("boom");
  });

  it("경고는 표시가 붙는다", () => {
    logWarn("a", "느리다");
    expect(JSON.parse(peekUsageBuffer()[0]).msg).toBe("warn: 느리다");
  });

  it("세션 시작이 버전과 플랫폼을 든다", () => {
    logSessionStart("3.1.2", "windows");
    expect(JSON.parse(peekUsageBuffer()[0])).toMatchObject({ k: "session", v: "3.1.2", os: "windows" });
  });
});

describe("🔴 절대 던지지 않는다", () => {
  /** `logError` 가 던지면 오류 처리 중에 오류가 나고 원래 오류가 사라진다. */
  it("직렬화가 안 되는 값을 줘도 안 던진다", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => logError("a", "b", cyclic)).not.toThrow();
  });

  it("flush 가 실패해도 안 던진다", async () => {
    invoke.mockRejectedValue(new Error("no tauri"));
    logCommand("x", "palette");
    await expect(flushUsage()).resolves.toBeUndefined();
  });

  /** ⚠️ 실패하면 **버퍼를 되돌린다** — 다음 기회에 다시 보내려고. */
  it("flush 가 실패하면 잃지 않는다", async () => {
    invoke.mockRejectedValue(new Error("no tauri"));
    logCommand("x", "palette");
    await flushUsage();
    expect(peekUsageBuffer().length).toBe(1);
  });
});

describe("끄면 안 담는다", () => {
  it("off 면 버퍼가 안 는다", () => {
    usageEnabled.set(false);
    logCommand("x", "palette");
    logError("a", "b");
    expect(peekUsageBuffer().length).toBe(0);
  });

  it("설정이 영속화된다", () => {
    usageEnabled.set(false);
    expect(localStorage.getItem("lapis.usage-log")).toBe("off");
  });
});

describe("flush", () => {
  it("달과 줄을 넘긴다", async () => {
    logCommand("x", "palette");
    await flushUsage();
    const [cmd, args] = invoke.mock.calls[0] as [string, { month: string; lines: string[] }];
    expect(cmd).toBe("usage_append");
    expect(args.month).toMatch(/^\d{4}-\d{2}$/);
    expect(args.lines).toHaveLength(1);
  });

  it("보내고 나면 버퍼가 빈다", async () => {
    logCommand("x", "palette");
    await flushUsage();
    expect(peekUsageBuffer().length).toBe(0);
  });

  it("빈 버퍼면 아예 안 부른다", async () => {
    await flushUsage();
    expect(invoke).not.toHaveBeenCalled();
  });

  /** ⚠️ 상한에 닿아 버려진 줄은 **세어서 보여준다** — 조용히 버리면 통계가 거짓말이 된다. */
  it("버려진 줄을 센다", async () => {
    invoke.mockResolvedValue({ written: 0, dropped: 3 });
    logCommand("x", "palette");
    await flushUsage();
    expect(get(usageDropped)).toBe(3);
  });
});
