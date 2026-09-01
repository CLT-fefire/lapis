import { existsSync } from "node:fs";
import path from "node:path";

/**
 * 설치된 Lapis 실행파일 찾기 — 헤드리스 인덱싱(`lapis index`)이 부를 대상.
 *
 * ## 왜 앱 실행파일이 필요한가
 *
 * 인덱스 생산자는 Rust 하나뿐이고(README 설계 원칙), 캐시 디렉터리를 아는 것도
 * `AppHandle`뿐이다(`src-tauri/src/headless.rs`). Node가 그 둘을 흉내내면 앱이 읽지
 * 않는 곳에 틀린 인덱스를 쓰게 된다.
 *
 * ## ⚠️ 후보를 늘어놓지 않고 **먼저 물어본다**
 *
 * `LAPIS_APP`이 있으면 그것만 쓴다. 추측 목록을 먼저 뒤지면 사용자가 지정한 빌드가
 * 아니라 우연히 먼저 걸린 빌드를 쓰게 되고, dev 빌드와 릴리즈 빌드는 **캐시 디렉터리가
 * 다르다**(`paths.rs`의 `-dev` 접미사). 엉뚱한 쪽을 인덱싱하면 앱에서는 아무 변화가 없다.
 */

/**
 * 이 플랫폼에서 볼 만한 설치 위치. 순서가 곧 우선순위다.
 *
 * ⚠️ `path.join`이 아니라 **`path.win32` / `path.posix`** 를 명시한다. `path.join`은
 * 인자로 받은 `platform`이 아니라 **지금 도는 호스트**의 규칙을 쓴다 — 그러면 이 함수가
 * 플랫폼을 인자로 받는 의미가 없어지고, Windows 후보가 `C:\u\Local/Lapis/Lapis.exe`
 * 같은 섞인 경로로 나온다. 리눅스 CI에서 드러났다.
 */
export function candidatePaths(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): string[] {
  if (platform === "win32") {
    const j = path.win32.join;
    const local = env.LOCALAPPDATA;
    const programs = env.ProgramFiles;
    return [
      // NSIS 기본(per-user). 이 머신의 실제 설치 위치다.
      ...(local ? [j(local, "Lapis", "Lapis.exe")] : []),
      // 예전/변형 레이아웃.
      ...(local ? [j(local, "Programs", "Lapis", "Lapis.exe")] : []),
      // per-machine 설치.
      ...(programs ? [j(programs, "Lapis", "Lapis.exe")] : []),
    ];
  }
  if (platform === "darwin") {
    const home = env.HOME;
    return [
      "/Applications/Lapis.app/Contents/MacOS/Lapis",
      ...(home
        ? [path.posix.join(home, "Applications", "Lapis.app", "Contents", "MacOS", "Lapis")]
        : []),
    ];
  }
  return [];
}

export interface LocateResult {
  ok: true;
  exe: string;
  /** 어디서 왔는지 — 사람이 "왜 저 빌드지"를 물을 때 답이 된다. */
  source: "env" | "installed";
}

export interface LocateFailure {
  ok: false;
  tried: string[];
}

/**
 * 실행파일을 찾는다. `exists`를 주입받아 테스트가 파일시스템 없이 돈다.
 *
 * ⚠️ `LAPIS_APP`이 가리키는 파일이 **없으면 후보로 넘어가지 않고 실패한다.** 사용자가
 * 명시적으로 지정한 것이 틀렸다면 조용히 다른 걸 쓰는 게 아니라 그 사실을 알려야 한다.
 */
export function locateApp(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  exists: (p: string) => boolean = existsSync,
): LocateResult | LocateFailure {
  const override = env.LAPIS_APP;
  if (override) {
    return exists(override)
      ? { ok: true, exe: override, source: "env" }
      : { ok: false, tried: [override] };
  }
  const tried = candidatePaths(platform, env);
  const hit = tried.find(exists);
  return hit ? { ok: true, exe: hit, source: "installed" } : { ok: false, tried };
}

/** 못 찾았을 때 사람에게 줄 처방. 목록을 그대로 보여준다 — 어디를 봤는지 알아야 고친다. */
export function locateRemedy(tried: readonly string[]): string {
  const list = tried.length > 0 ? tried.map((t) => `    ${t}`).join("\n") : "    (후보 없음)";
  return `Lapis 실행파일을 못 찾았다. 찾아본 곳:\n${list}\n  LAPIS_APP 환경변수로 직접 지정할 수 있다.`;
}
