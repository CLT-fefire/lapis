import { spawn } from "node:child_process";

import { locateApp, locateRemedy } from "./appLocate.ts";

/**
 * `lapis open` 이 앱을 부르는 방법.
 *
 * ## ⚠️ 기다리지 않는다 — 떼어내 보낸다
 *
 * 앱이 떠 있으면 두 번째 프로세스는 argv를 넘기고 곧 죽지만, **꺼져 있으면 방금 띄운 그
 * 프로세스가 앱 본체다.** `spawnSync`로 기다리면 사용자가 창을 닫을 때까지 터미널이
 * 잡혀 있게 된다.
 *
 * 그래서 `detached` + `unref()`로 보내고 즉시 돌아온다. stdio도 끊는다 — 안 끊으면 앱이
 * 터미널 파이프를 붙들어, 프로세스를 떼어놨어도 셸이 안 끝나는 경우가 생긴다.
 */

export class LaunchError extends Error {
  constructor(
    message: string,
    readonly remedy?: string,
  ) {
    super(message);
    this.name = "LaunchError";
  }
}

export interface LaunchOptions {
  /** 열 노트의 절대 경로. */
  path: string;
  /** 그 노트가 속한 vault 루트. 어느 창이 받을지 앱이 이걸로 가른다. */
  vault: string;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  /** 테스트용 주입. 기본은 실제 `spawn`. */
  spawnFn?: typeof spawn;
}

/** 앱에 넘길 인자. 순수 함수라 테스트가 문자열만 본다. */
export function openArgs(path: string, vault: string): string[] {
  return ["--open", path, "--open-vault", vault];
}

export function launchOpen(opts: LaunchOptions): { exe: string } {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const located = locateApp(platform, env);
  if (!located.ok) {
    throw new LaunchError("Lapis 실행파일을 찾지 못했다", locateRemedy(located.tried));
  }

  const child = (opts.spawnFn ?? spawn)(located.exe, openArgs(opts.path, opts.vault), {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  return { exe: located.exe };
}
