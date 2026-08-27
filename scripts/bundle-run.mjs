// bundle-run.mjs — TS 진입점을 호출 시점에 번들해서 Node로 실행한다. **Windows용.**
//
//   사용: node scripts/bundle-run.mjs <이름> <진입점 절대경로> [인자...]
//
// `cli/lapis.cmd` · `mcp/lapis-*.cmd`가 이걸 부른다.
//
// ## ⚠️ `bundle-run.sh`와 왜 두 벌인가
//
// Windows 셸은 `#!/bin/sh` 스크립트를 실행할 줄 모른다. `cli/lapis`를 치면 "이 파일을 열
// 앱을 고르라"는 창이 뜬다 — 에러도 아니고 지원 안 한다는 말도 없다. 그래서 `.cmd` 짝이
// 필요하고, `.cmd`에서 sh를 부르려면 Git Bash 경로를 추측해야 한다(PowerShell의 PATH에는
// `sh`도 `bash`도 없는 것이 기본이다 — 실측).
//
// 두 벌이 된 대신 **공유하는 것은 계약 둘뿐**이고, 그 둘은 `launchers.test.ts`가 못 박는다:
//
//   1. esbuild에 `--alias:$lib=<repo>/src/lib` 를 준다 (안 주면 앱 트리를 못 읽는다)
//   2. 자식에게 `LAPIS_REPO` 를 넘긴다 (번들이 TMPDIR에 있어 리포 위치를 모른다)
//
// 나머지(node 탐색·임시 파일)는 플랫폼별 사정이라 갈리는 게 맞다. sh 쪽은 **최소 PATH로
// 뜨는 MCP 클라이언트** 때문에 node를 손으로 찾아야 하지만, 여기는 node가 이미 돌고 있다.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [name, entry, ...rest] = process.argv.slice(2);
if (!name || !entry) {
  console.error("bundle-run.mjs: 사용법 — node bundle-run.mjs <이름> <진입점> [인자...]");
  process.exit(2);
}

const REPO = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const TMP = os.tmpdir();

// ⚠️ 하루 지난 잔재를 쓸어낸다. 성공 경로에서 자식이 살아 있는 동안 부모가 지울 수 없어
//    파일 하나가 남는다 — sh 쪽도 같은 이유로 같은 청소를 한다.
const DAY_MS = 24 * 60 * 60 * 1000;
try {
  for (const f of readdirSync(TMP)) {
    if (!f.startsWith("lapis-") || !f.endsWith(".mjs")) continue;
    const full = path.join(TMP, f);
    try {
      if (Date.now() - statSync(full).mtimeMs > DAY_MS) rmSync(full, { force: true });
    } catch {
      // 다른 프로세스가 쓰는 중이거나 이미 사라졌다. 청소는 최선 노력이다.
    }
  }
} catch {
  // TMPDIR을 못 읽어도 실행은 계속한다.
}

// ⚠️ **호출별 고유 이름.** 고정 이름이면 세션 두 개가 동시에 뜰 때 esbuild가 같은 파일에
//    겹쳐 쓴다(esbuild는 임시 파일 후 rename이 아니라 직접 쓴다). 한쪽이 쓰는 중인 파일을
//    다른 쪽이 실행해 구문 오류로 죽는다.
const out = path.join(TMP, `lapis-${name}-${process.pid}.mjs`);

// esbuild는 **JS API**로 부른다. `.bin` 경로를 손으로 짜면 플랫폼별 확장자(`.cmd`)를
// 맞춰야 하고, 그건 또 하나의 추측이다.
const { buildSync } = await import("esbuild");
try {
  buildSync({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "warning",
    // ⚠️ 계약 ① — `$lib` 별칭. 없으면 Node가 앱 트리를 직접 못 읽는다.
    alias: { $lib: path.join(REPO, "src", "lib") },
    outfile: out,
    allowOverwrite: true,
  });
} catch {
  // esbuild가 이미 stderr에 냈다. 여기서 또 찍으면 두 번 보인다.
  process.exit(1);
}

const r = spawnSync(
  process.execPath,
  ["--no-warnings", out, ...rest],
  {
    stdio: "inherit",
    // ⚠️ 계약 ② — 번들은 TMPDIR에 있어 리포 위치를 모른다. `--version`처럼 package.json이
    //    필요한 곳이 있어 여기서 넘긴다.
    env: { ...process.env, LAPIS_REPO: REPO },
  },
);

if (existsSync(out)) {
  try {
    rmSync(out, { force: true });
  } catch {
    // 위 청소가 나중에 걷어간다.
  }
}

// ⚠️ 자식의 종료 코드를 그대로 물려준다. 여기서 0으로 삼키면 `lapis doctor`가 CI에서
//    항상 통과한다 — 그게 이 도구가 가장 하면 안 되는 일이다.
process.exit(r.status ?? 1);
