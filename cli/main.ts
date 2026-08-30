import { readFileSync } from "node:fs";
import path from "node:path";

import { LapisError } from "../core/cache.ts";
import { parseArgs, UsageError, type ParsedCommand } from "./args.ts";
import { HANDLERS, type Out } from "./handlers.ts";
import { renderRootHelp, renderCommandHelp, renderError } from "./render.ts";

/**
 * CLI 진입점 — **IO는 여기에만 있다.**
 *
 * 표면 정의(`spec.ts`) · 파싱(`args.ts`) · 렌더(`render.ts`) · 핸들러(`handlers.ts`)는
 * 전부 순수하거나 `Out`을 통해서만 출력한다. 이 파일은 그것들을 엮고 프로세스를 끝낸다.
 *
 * 질의 핵은 `mcp/query.ts`의 `lapisQuery()`다 — MCP 서버와 **같은 함수**를 부른다.
 * 복제하면 랭킹이 두 벌이 되고 한쪽만 바뀌어도 아무도 모른다.
 */

/** 종료 코드. `cli/README.md`의 표와 같아야 한다. */
const EXIT_OK = 0;
const EXIT_QUERY = 1;
const EXIT_USAGE = 2;

function makeOut(json: boolean): Out {
  return {
    json,
    line: (text) => process.stdout.write(text + "\n"),
    json_: (value) => process.stdout.write(JSON.stringify(value, null, 2) + "\n"),
    /**
     * ⚠️ `--json`이면 **stderr에도 JSON**을 낸다. 기계가 실패 이유를 파싱할 수 있어야
     * 한다 — 사람용 문장만 내면 호출부는 종료 코드밖에 못 본다.
     */
    fail: (kind, message, remedy, code) => {
      if (json) {
        process.stderr.write(JSON.stringify({ error: { kind, message, remedy } }, null, 2) + "\n");
      } else {
        process.stderr.write(renderError(kind, message, remedy) + "\n");
      }
      process.exit(code);
    },
  };
}

function version(): string {
  // 번들은 TMPDIR에 있어 리포 위치를 모른다. 러너가 `LAPIS_REPO`로 알려준다.
  const repo = process.env.LAPIS_REPO;
  if (!repo) return "unknown";
  try {
    const pkg = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function main(argv: readonly string[]): Promise<void> {
  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(version() + "\n");
    process.exit(EXIT_OK);
  }

  // 파싱이 실패해도 `--json` 여부는 알아야 한다 — 오류를 어떤 모양으로 낼지가 거기 달렸다.
  const out: Out = makeOut(argv.includes("--json"));

  let parsed: ParsedCommand;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    // 인자 없이 부르면 도움말이 **정상 출력**이다 — stdout, 종료 0.
    if (e.message === "") {
      process.stdout.write(renderRootHelp() + "\n");
      process.exit(EXIT_OK);
    }
    out.fail("usage", e.message, "`lapis --help` 로 사용법을 볼 수 있다", EXIT_USAGE);
  }

  if (parsed.help) {
    process.stdout.write(renderCommandHelp(parsed.command) + "\n");
    process.exit(EXIT_OK);
  }

  const handler = HANDLERS[parsed.command.name];
  // spec에 있는데 핸들러가 없으면 사용자 잘못이 아니다. 테스트가 이걸 막지만, 그래도
  // 조용히 아무것도 안 하는 것보다 소리내어 죽는 게 낫다.
  if (!handler) {
    out.fail("internal", `핸들러가 없다: ${parsed.command.name}`, "저장소 버그다", EXIT_QUERY);
  }

  try {
    // 핸들러는 동기일 수도 비동기일 수도 있다(쓰기 명령은 비동기다). await 하면 둘 다 된다.
    await handler(parsed, out);
  } catch (e) {
    if (e instanceof LapisError) {
      out.fail(e.kind, e.message, e.remedy, EXIT_QUERY);
    }
    throw e;
  }
  // ⚠️ 핸들러가 `process.exitCode`를 세웠으면 **존중한다.** `doctor`가 "문제를 찾았다"를
  //    종료 코드로 말하는데, 무조건 `EXIT_OK`로 끝내면 그 신호가 조용히 사라진다 —
  //    훅이나 CI에서는 종료 코드가 유일한 신호라 아무도 눈치 못 챈다.
  process.exit(typeof process.exitCode === "number" ? process.exitCode : EXIT_OK);
}

// ⚠️ 최상위 await 대신 catch를 붙인다. 여기서 새는 예외는 버그다 — 조용히 0으로
// 끝나면 스크립트가 성공으로 읽는다.
main(process.argv.slice(2)).catch((e) => {
  process.stderr.write(`lapis: 예상치 못한 오류 — ${String(e)}\n`);
  process.exit(1);
});
