import { describe, it, expect, vi } from "vitest";
import { openArgs, launchOpen, LaunchError } from "./appLaunch.ts";

/**
 * `lapis open` 이 앱을 부르는 방법 — **테스트가 0이었다.**
 *
 * ⚠️ 여기가 틀리면 **터미널이 안 돌아온다.** 앱이 꺼져 있을 때는 방금 띄운 프로세스가
 * 앱 본체라, 기다리면 사용자가 창을 닫을 때까지 셸이 잡혀 있다. 그건 에러가 아니라
 * "명령이 안 끝나는" 상태다.
 */

function fakeSpawn() {
  const unref = vi.fn();
  const spawn = vi.fn(() => ({ unref })) as unknown as typeof import("node:child_process").spawn;
  return { spawn, unref, calls: () => (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls };
}

describe("openArgs", () => {
  it("경로와 vault 를 둘 다 넘긴다", () => {
    expect(openArgs("/v/a.md", "/v")).toEqual(["--open", "/v/a.md", "--open-vault", "/v"]);
  });

  /** ⚠️ vault 가 빠지면 앱이 **어느 창이 받을지** 못 가른다 — 다른 vault 창이 연다. */
  it("vault 인자가 빠지지 않는다", () => {
    expect(openArgs("/v/a.md", "/v")).toContain("--open-vault");
  });

  it("공백이 든 경로도 인자 하나로 간다", () => {
    const args = openArgs("/v/a b.md", "/v/my vault");
    expect(args[1]).toBe("/v/a b.md");
    expect(args[3]).toBe("/v/my vault");
  });
});

describe("launchOpen", () => {
  // ⚠️ `locateApp` 은 파일이 **실제로 있는지** 본다(지정한 것이 없으면 조용히 다른 걸
  //    쓰지 않고 실패한다). 그래서 반드시 존재하는 실행파일을 준다.
  const env = { LAPIS_APP: process.execPath };

  /**
   * ⚠️ **떼어내 보내야 한다.** `detached` 와 `unref()` 가 둘 다 있어야 터미널이 즉시
   * 돌아온다. 하나만 있으면 어떤 셸에서는 안 끝난다.
   */
  it("detached + unref 로 보낸다", () => {
    const { spawn, unref, calls } = fakeSpawn();
    launchOpen({ path: "/v/a.md", vault: "/v", env, platform: "win32", spawnFn: spawn });
    const [, , opts] = calls()[0] as [string, string[], Record<string, unknown>];
    expect(opts.detached).toBe(true);
    expect(unref).toHaveBeenCalled();
  });

  /** ⚠️ stdio 를 안 끊으면 앱이 터미널 파이프를 붙들어 셸이 안 끝난다. */
  it("stdio 를 끊는다", () => {
    const { spawn, calls } = fakeSpawn();
    launchOpen({ path: "/v/a.md", vault: "/v", env, platform: "win32", spawnFn: spawn });
    const [, , opts] = calls()[0] as [string, string[], Record<string, unknown>];
    expect(opts.stdio).toBe("ignore");
  });

  it("실행파일과 인자를 그대로 넘긴다", () => {
    const { spawn, calls } = fakeSpawn();
    const r = launchOpen({ path: "/v/a.md", vault: "/v", env, platform: "win32", spawnFn: spawn });
    const [exe, args] = calls()[0] as [string, string[]];
    expect(exe).toBe(r.exe);
    expect(args).toEqual(openArgs("/v/a.md", "/v"));
  });

  /**
   * ⚠️ 못 찾았을 때 **조용히 성공하면 안 된다.** 아무 일도 안 일어나는데 명령은 0을
   * 돌려주면 사용자는 앱이 뜬 줄 안다.
   */
  it("실행파일을 못 찾으면 처방과 함께 던진다", () => {
    const { spawn } = fakeSpawn();
    expect(() =>
      launchOpen({ path: "/v/a.md", vault: "/v", env: {}, platform: "win32", spawnFn: spawn }),
    ).toThrow(LaunchError);

    try {
      launchOpen({ path: "/v/a.md", vault: "/v", env: {}, platform: "win32", spawnFn: spawn });
    } catch (e) {
      expect((e as LaunchError).remedy, "처방이 없으면 사용자가 다음에 뭘 할지 모른다").toBeTruthy();
    }
  });

  it("못 찾으면 spawn 을 아예 안 부른다", () => {
    const { spawn } = fakeSpawn();
    try {
      launchOpen({ path: "/v/a.md", vault: "/v", env: {}, platform: "win32", spawnFn: spawn });
    } catch {
      /* 기대된 예외 */
    }
    expect(spawn).not.toHaveBeenCalled();
  });
});
