import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { launchOpen, LaunchError } from "./appLaunch.ts";

/**
 * 실행 중인 앱에 렌더를 시키고 결과 파일을 기다린다 — **MCP 와 CLI 가 나눠 쓴다.**
 *
 * ## 🔴 왜 한 곳에 두나
 *
 * `lapis_render`(MCP) 를 만들고 나서 CLI 에는 그 짝이 없었다. CLI 의 `export` 는
 * 브라우저 없는 자체 변환기라 mermaid 가 코드 펜스로 남는다.
 *
 * 같은 일을 CLI 에 다시 적으면 **argv 이름 · 타임아웃 · 실패 판정이 세 곳(Rust · MCP ·
 * CLI)에 흩어진다.** 이 저장소에서 가장 자주 나온 결함이 "규칙이 두 곳에 있어 갈린 것"이다.
 *
 * ⚠️ 실제로 한 번 당했다 — 손으로 `--render-note` 라고 쳤더니 Rust 의 `parse_render` 가
 * `None` 을 돌려주고 **아무 로그도 안 남긴 채** 지나갔다. 부른 쪽은 타임아웃으로만 알았다.
 * 그래서 플래그 문자열은 여기서만 만든다.
 *
 * ## ⚠️ 왜 앱을 거치나 — 직접 그리지 않고
 *
 * mermaid 도 수식도 사용자 CSS 도 **브라우저에서만** 그려진다. 여기서 직접 그리려면
 * 헤드리스 브라우저를 하나 더 끌어와야 하고, 그러면 **렌더러가 둘**이 되어 서로 다른
 * 그림을 내기 시작한다. 느리지만 갈리지 않는 쪽을 골랐다.
 */

/** ⚠️ `src-tauri/src/clirender.rs` 의 `FORMATS` 와 **같아야 한다.** 갈리면 앱이 조용히 아무것도 안 한다. */
export const RENDER_FORMATS = ["html", "png"] as const;

export type RenderFormat = (typeof RENDER_FORMATS)[number];

export interface RenderArgs {
  notePath: string;
  vault: string;
  /** OS 에 넘기는 native 경로 — 응답에 담을 것은 호출부가 정규화한다. */
  outNative: string;
  format: RenderFormat;
}

/** argv 조립. **플래그 이름이 사는 유일한 자리다.** */
export function renderArgs(a: RenderArgs): string[] {
  return [
    "--render",
    a.notePath,
    "--render-vault",
    a.vault,
    "--render-out",
    a.outNative,
    "--render-format",
    a.format,
  ];
}

export type RenderOutcome =
  | { ok: true; bytes: number }
  | { ok: false; kind: "app_not_found"; message: string; remedy: string }
  | { ok: false; kind: "app_timeout"; message: string; remedy: string }
  | { ok: false; kind: "export_failed"; message: string; remedy: string };

/**
 * 요청을 보내고 결과 파일을 기다린다.
 *
 * ⚠️ **기다리기 전에 옛 결과를 지운다.** 지난 실행의 파일이 남아 있으면 그걸 보고
 * 즉시 성공이라 한다 — 앱이 아무것도 안 했는데 "됐다"가 되고, 부른 쪽은 옛 그림을
 * 새 그림으로 읽는다.
 */
export function requestRender(a: RenderArgs, timeoutMs: number): RenderOutcome {
  cleanup(a.outNative);
  mkdirSync(path.dirname(a.outNative), { recursive: true });

  try {
    launchOpen({
      path: a.notePath,
      vault: a.vault,
      extraArgs: renderArgs(a),
    });
  } catch (e) {
    if (e instanceof LaunchError) {
      return {
        ok: false,
        kind: "app_not_found",
        message: e.message,
        remedy: e.remedy ?? "",
      };
    }
    throw e;
  }

  if (!waitForFile(a.outNative, timeoutMs)) {
    return {
      ok: false,
      kind: "app_timeout",
      message: `앱이 ${timeoutMs}ms 안에 결과를 안 냈다`,
      // 🔴 **원인이 둘인데 하나만 말하면 맞는 것을 확인하고 막힌다.**
      //    실측: 앱이 떠 있는데도 "떠 있는지 확인할 것"이 나왔다 — 진짜 원인은 그 앱이
      //    `--render` 를 모르는 구버전이라는 것이었다. 옛 빌드는 모르는 인자를 조용히
      //    무시하고, 두 번째 프로세스는 argv 를 넘긴 뒤 그냥 끝난다. 아무도 실패를 안 쓴다.
      //
      //    ⚠️ 떠 있는 앱에게 버전을 물을 통로가 없다 — 네트워킹 코드가 없고 argv 는
      //    한 방향이다. 탐지 대신 두 원인을 다 적는다.
      remedy:
        "① 앱 버전이 3.10.0 이상인지 — 그 아래는 --render 를 모르고 조용히 무시한다. " +
        "② 앱이 떠 있는지 — 꺼져 있으면 켜지는 시간이 더 든다(타임아웃을 늘릴 수 있다).",
    };
  }

  const failure = readFailure(a.outNative);
  if (failure) {
    return { ok: false, kind: "export_failed", message: failure, remedy: "앱 쪽 로그를 볼 것" };
  }

  return { ok: true, bytes: statSync(a.outNative).size };
}

/**
 * 결과 파일이 실패 보고인가.
 *
 * 🔴 앱은 실패해도 **같은 경로에** 쓴다(`write_render_failure`). 그걸 성공으로 읽으면
 * 부른 쪽이 에러 JSON 을 PNG 로 알고 넘어간다.
 */
function readFailure(file: string): string | null {
  try {
    // 4KB 를 넘으면 실패 보고가 아니다 — 진짜 결과물이다.
    if (statSync(file).size > 4096) return null;
    const raw = readFileSync(file, "utf-8");
    if (!raw.startsWith("{")) return null;
    const v = JSON.parse(raw);
    return v.ok === false ? (v.error ?? "앱이 실패를 보고했다") : null;
  } catch {
    return null;
  }
}

/**
 * 결과 파일이 생길 때까지 기다린다.
 *
 * ⚠️ **크기가 0 이면 아직이다.** 쓰는 중인 파일을 보고 끝났다 하면 잘린 것을 읽는다.
 *
 * ⚠️ 부르는 쪽이 stdio 를 잡고 있어 비동기 대기가 간단하지 않다 — 자식 프로세스로 잰다.
 * 바쁜 기다림보다 싸다.
 */
function waitForFile(file: string, timeoutMs: number, pollMs = 60): boolean {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (statSync(file).size > 0) return true;
    } catch {
      // 아직 안 생겼다.
    }
    if (Date.now() >= until) return false;
    spawnSync(process.execPath, ["-e", `setTimeout(()=>{}, ${pollMs})`]);
  }
}

/** 🔴 지난 실행의 파일이 남아 있으면 그걸 보고 **즉시 성공**이라 한다. */
function cleanup(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {
    // 못 지웠으면 아래 대기가 옛 파일을 볼 수 있다 — 그건 위에서 크기로 거른다.
  }
}
