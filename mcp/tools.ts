import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { homedir, tmpdir } from "node:os";
import { resolveNotePath } from "./query.ts";
import {
  LapisError,
  resolveVault,
  usageDirs,
  normPath,
  checkStale,
} from "./cache.ts";
import { UsageAnalyzer } from "$lib/usageAnalyzer";
import { collectOpenTasks, countOpenTasks } from "$lib/openTasks";
import { buildIndex } from "$lib/linkIndex";
import { launchOpen, LaunchError } from "../cli/appLaunch.ts";
import { runIndex, IndexError } from "../cli/indexRun.ts";
import { runExport, ExportError } from "../cli/exportRun.ts";

/**
 * MCP 앱 조작 도구들.
 *
 * ## 🔴 스키마와 실행을 한 표에 둔다
 *
 * 도구 정의를 한 곳, 실행을 다른 곳에 두면 추가할 때 한쪽만 하고 만다 — 그러면
 * **목록에는 보이는데 부르면 죽는다.** 에러가 나긴 나지만 그 지점은 이미 LLM 이
 * 도구를 골라 부른 뒤라, 원인에서 한참 떨어진 신호다.
 *
 * ⚠️ **게이트는 여기 안 본다.** 호출 직전에 `server.ts` 가 한 번 본다 — 도구마다
 * 검사하게 두면 새 도구가 하나 빠뜨려져도 아무도 모른다.
 *
 * ⚠️ **vault 쓰기 도구는 여기 없다.** 노트 만들기·찾아 바꾸기는 CLI 에 둔다 —
 * 되돌리기 비용이 다르고, 나중에 얹을 수는 있어도 되돌릴 수는 없다.
 * `lapis_render` · `lapis_export_html` 은 vault **밖으로**만 쓴다.
 */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>): unknown;
}

/** 빈 문자열을 `undefined` 로 본다 — `""` 를 값으로 받으면 다음 줄에서야 틀린다. */
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;
const openTool: ToolDef = {
  name: "lapis_open",
  description:
    "실행 중인 Lapis 앱에서 이 노트를 연다. 앱이 꺼져 있으면 켠다.\n\n· 노트는 **이름만 줘도** 된다(경로·확장자 불필요). `lapis_query` 가 내는 경로를 그대로 줘도 된다.\n· ⚠️ **결과를 확인할 방법이 없다.** 떼어내 보내고 즉시 돌아오므로 앱이 실제로 열었는지는 모른다 — 그래서 '열었다'가 아니라 '보냈다'라고 답한다.\n· 사람에게 무언가를 **보여주고 싶을 때** 쓴다. 내용을 읽으려면 `lapis_query` 를 쓴다.",
  inputSchema: {
    type: "object",
    properties: {
      note: { type: "string", description: "경로 · 노트 이름 아무거나" },
      vault: {
        type: "string",
        description: "vault 루트. 캐시에 여러 vault가 있을 때",
      },
    },
    required: ["note"],
  },
  run(args: Record<string, unknown>) {
    const note = str(args.note);
    if (!note)
      throw new LapisError(
        "usage",
        "note 가 필요하다",
        "노트 이름이나 경로를 줄 것",
      );
    const resolved = resolveNotePath(note, str(args.vault));
    try {
      const { exe } = launchOpen({
        path: resolved.path,
        vault: resolved.vault,
      });
      // ⚠️ 응답에 담기는 경로는 전부 `/` 다 — 소비자가 `split("/")` 로 다룬다.
      return { ...resolved, sent: true, app: normPath(exe) };
    } catch (e) {
      if (e instanceof LaunchError) {
        throw new LapisError("app_not_found", e.message, e.remedy ?? "");
      }
      throw e;
    }
  },
};
const revealTool: ToolDef = {
  name: "lapis_reveal",
  description:
    "노트가 든 폴더를 OS 파일 관리자에서 연다(그 파일을 선택한 채로).\n\n· 앱이 아니라 **탐색기·Finder** 를 연다. 파일을 다른 도구로 다루려 할 때 쓴다.\n· 노트 대신 폴더 경로를 줘도 된다.",
  inputSchema: {
    type: "object",
    properties: {
      note: { type: "string", description: "경로 · 노트 이름 아무거나" },
      vault: { type: "string", description: "vault 루트" },
    },
    required: ["note"],
  },
  run(args: Record<string, unknown>) {
    const note = str(args.note);
    if (!note)
      throw new LapisError(
        "usage",
        "note 가 필요하다",
        "노트 이름이나 경로를 줄 것",
      );
    const resolved = resolveNotePath(note, str(args.vault));
    revealInFileManager(resolved.path);
    return { ...resolved, revealed: true };
  },
};
/**
 * 파일 관리자에서 선택한 채로 연다.
 *
 * ⚠️ 플랫폼마다 명령이 다르고 **인자 모양도 다르다.** Windows 는 `/select,` 뒤에 공백이
 * 없어야 하고, macOS 는 `-R`, Linux 는 표준이 없어 폴더만 연다.
 */
export function revealInFileManager(target: string): void {
  const p = path.resolve(target);
  if (process.platform === "win32") {
    // ⚠️ `explorer` 는 선택 성공에도 exit 1 을 낸다 — 코드를 보고 실패로 판정하면 안 된다.
    spawnSync("explorer.exe", [`/select,${p}`], { windowsHide: false });
    return;
  }
  if (process.platform === "darwin") {
    spawnSync("open", ["-R", p]);
    return;
  }
  spawnSync("xdg-open", [path.dirname(p)]);
}
const indexTool: ToolDef = {
  name: "lapis_index",
  description:
    "앱을 켜지 않고 vault 인덱스를 다시 만든다. `lapis_query` 가 `stale` 을 냈을 때 쓴다.\n\n· ⚠️ 설치된 Lapis 실행파일을 헤드리스로 부른다 — 앱이 **떠 있으면** 그 인스턴스가 argv 를 삼키므로 실패한다. 그때는 앱이 이미 최신이니 그냥 다시 질의하면 된다.\n· 큰 vault 는 수 초 걸린다.",
  inputSchema: {
    type: "object",
    properties: {
      vault: { type: "string", description: "vault 루트 절대 경로" },
    },
    required: ["vault"],
  },
  run(args: Record<string, unknown>) {
    const vault = str(args.vault);
    if (!vault)
      throw new LapisError(
        "usage",
        "vault 가 필요하다",
        "vault 루트 절대 경로를 줄 것",
      );
    try {
      return runIndex({ vault });
    } catch (e) {
      if (e instanceof IndexError)
        throw new LapisError("index_failed", e.message, e.remedy ?? "");
      throw e;
    }
  },
};
const statsTool: ToolDef = {
  name: "lapis_stats",
  description:
    "vault 에 무엇이 있나 — 노트 수 · doc_kind · topic · 태그 수 · 미완 작업.\n\n· 값을 모를 때 `lapis_query` 의 `list` 대신 여기서 한 번에 훑는다.\n· ⚠️ 캐시 상태(낡았는지)도 같이 낸다.",
  inputSchema: {
    type: "object",
    properties: { vault: { type: "string", description: "vault 루트" } },
  },
  run(args: Record<string, unknown>) {
    const vc = resolveVault(str(args.vault));
    const count = (
      pick: (i: (typeof vc.infos)[number]) => string | null | undefined,
    ) => {
      const m = /* @__PURE__ */ new Map();
      for (const i of vc.infos) {
        const v = pick(i);
        if (v) m.set(v, (m.get(v) ?? 0) + 1);
      }
      return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
    };
    const tags = /* @__PURE__ */ new Set();
    for (const i of vc.infos) for (const t of i.tags ?? []) tags.add(t);
    const bodies = [];
    for (const i of vc.infos) {
      try {
        bodies.push({
          path: i.source_path,
          body: readFileSync(i.source_path, "utf-8"),
        });
      } catch {}
    }
    return {
      vault: vc.root,
      notes: vc.infos.length,
      doc_kinds: count((i) => i.doc_kind),
      topics: count((i) => i.topic),
      tags: tags.size,
      tasks: countOpenTasks(collectOpenTasks(bodies)),
      stale: checkStale(vc),
    };
  },
};
const usageTool: ToolDef = {
  name: "lapis_usage",
  description:
    "앱 사용 기록 요약 — 많이 쓴 명령 · 결과가 0건이던 질의 · 성능 · 오류.\n\n· 앱이 `analysis.md` 를 만들 때 쓰는 **같은 집계**다.\n· 기록이 없으면 실패한다 — 앱을 한 번 켜면 쌓이기 시작한다.",
  inputSchema: {
    type: "object",
    properties: {
      dir: { type: "string", description: "로그 폴더. 기본은 앱 데이터 폴더" },
    },
  },
  run(args: Record<string, unknown>) {
    const explicit = str(args.dir);
    const dirs = explicit ? [explicit] : usageDirs();
    const dir = dirs.find((d) => existsSync(d));
    if (!dir) {
      throw new LapisError(
        "no_usage_log",
        "사용 기록이 없다",
        "앱을 한 번 켜면 쌓이기 시작한다",
      );
    }
    const months = readdirSyncSafe(dir)
      .filter((f) => /^\d{4}-\d{2}\.log$/.test(f))
      .sort();
    if (months.length === 0) {
      throw new LapisError(
        "no_usage_log",
        `${dir} 에 로그가 없다`,
        "앱을 한 번 켜 볼 것",
      );
    }
    const a = new UsageAnalyzer();
    for (const f of months) {
      a.feedAll(
        readFileSync(path.join(dir, f), "utf-8")
          .split(/\r?\n/)
          .filter((l) => l.trim()),
      );
    }
    return { dir: normPath(dir), months, ...a.result() };
  },
};
/** 폴더가 없는 것과 비어 있는 것을 같게 다룬다 — 둘 다 "기록이 없다"다. */
function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
const exportTool: ToolDef = {
  name: "lapis_export_html",
  description:
    "노트를 자립 HTML 한 장으로 저장한다(스타일 인라인, 외부 참조 없음).\n\n· ⚠️ **앱의 내보내기와 다르다.** 브라우저가 없어 mermaid 는 **코드 펜스로 남고** 사용자 정의 CSS 는 안 붙는다. 응답의 `differs_from_app` 이 그걸 말한다.\n· 인쇄 규칙이 들어 있어 브라우저에서 그대로 PDF 로 저장할 수 있다.\n· `out` 을 안 주면 노트 옆에 같은 이름으로 쓴다.",
  inputSchema: {
    type: "object",
    properties: {
      note: { type: "string", description: "경로 · 노트 이름 아무거나" },
      out: { type: "string", description: "저장할 파일 경로(.html)" },
      vault: { type: "string", description: "vault 루트" },
    },
    required: ["note"],
  },
  run(args: Record<string, unknown>) {
    const note = str(args.note);
    if (!note)
      throw new LapisError(
        "usage",
        "note 가 필요하다",
        "노트 이름이나 경로를 줄 것",
      );
    const resolved = resolveNotePath(note, str(args.vault));
    const out = str(args.out) ?? defaultHtmlPath(resolved.path);
    const repoRoot = process.env.LAPIS_REPO;
    if (!repoRoot) {
      throw new LapisError(
        "export_failed",
        "LAPIS_REPO 가 없다",
        "MCP 서버를 mcp/lapis-mcp 런처로 띄울 것 — 스타일 원본을 거기서 읽는다",
      );
    }
    const vc = resolveVault(resolved.vault);
    let html;
    try {
      html = runExport({
        notePath: resolved.path,
        repoRoot,
        index: buildIndex(vc.infos),
      }).html;
    } catch (e) {
      if (e instanceof ExportError)
        throw new LapisError("export_failed", e.message, e.remedy ?? "");
      throw e;
    }
    try {
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, html, "utf-8");
    } catch (e) {
      throw new LapisError("export_failed", `쓸 수 없다: ${out}`, String(e));
    }
    return {
      ...resolved,
      out: normPath(out),
      bytes: Buffer.byteLength(html, "utf-8"),
      // ⚠️ 부르는 쪽이 이걸 모르면 "왜 다이어그램이 안 나오지"가 된다.
      differs_from_app: [
        "mermaid 는 코드 펜스로 남는다",
        "사용자 정의 CSS 는 안 붙는다",
      ],
    };
  },
};
/**
 * `out` 을 안 주면 어디에 쓸까.
 *
 * ## 🔴 vault 안은 안 된다
 *
 * 처음엔 노트 **옆에** 뒀다 — 즉 vault 안이다. 이 모듈은 "vault 밖으로만 쓴다"고
 * 선언해 놓고 기본값이 그걸 어겼다. 조용한 부작용이다: 앱이 감시 중이면 그 쓰기가
 * 재색인을 부르고, 사용자는 자기가 안 만든 파일이 vault 에 쌓이는 걸 나중에야 본다.
 *
 * ⚠️ 홈 폴더가 없을 수 있다(서비스 계정 등). 그때는 임시 폴더로 물러난다 —
 * 없는 곳에 쓰려다 실패하는 것보다, 찾기 어려운 곳이라도 쓰고 **어디 썼는지 말하는** 게 낫다.
 */
export function defaultHtmlPath(notePath: string): string {
  const stem = path.basename(notePath).replace(/\.(md|mmd|markdown)$/i, "");
  const home = homedir();
  const downloads = home ? path.join(home, "Downloads") : "";
  const dir = downloads && existsSync(downloads) ? downloads : tmpdir();
  return path.join(dir, `${stem}.html`);
}
const renderTool: ToolDef = {
  name: "lapis_render",
  description:
    '실행 중인 Lapis 앱에게 렌더를 시켜 파일로 받는다 — **앱 품질** HTML 또는 mermaid PNG.\n\n· `format: "html"` — mermaid 가 **SVG 로 박제된** 자립 HTML. 사용자 정의 CSS 도 반영된다.\n  (`lapis_export_html` 은 브라우저가 없어 mermaid 를 코드 펜스로 남긴다 — 다이어그램이 필요하면 이쪽을 쓴다.)\n· `format: "png"` — 본문 **첫 번째** mermaid 다이어그램을 PNG 로. 여럿이면 첫 번째다.\n· ⚠️ **앱이 떠 있어야 하고, 버전이 3.10.0 이상이어야 한다.** 그 아래는 이 인자를 모르고 조용히 무시한다 — `app_timeout` 으로만 드러난다.\n· ⚠️ 앱이 **그 노트를 실제로 연다** — 사람이 보던 화면이 바뀐다.',
  inputSchema: {
    type: "object",
    properties: {
      note: { type: "string", description: "경로 · 노트 이름 아무거나" },
      out: { type: "string", description: "저장할 절대 경로" },
      format: {
        type: "string",
        enum: ["html", "png"],
        description: "기본 html",
      },
      vault: { type: "string", description: "vault 루트" },
      timeout_ms: { type: "number", description: "기다릴 상한. 기본 20000" },
    },
    required: ["note", "out"],
  },
  run(args: Record<string, unknown>) {
    const note = str(args.note);
    const out = str(args.out);
    if (!note || !out) {
      throw new LapisError(
        "usage",
        "note 와 out 이 필요하다",
        "저장할 절대 경로까지 줄 것",
      );
    }
    const format = str(args.format) ?? "html";
    if (format !== "html" && format !== "png") {
      throw new LapisError("usage", `모르는 형식: ${format}`, "html 또는 png");
    }
    const resolved = resolveNotePath(note, str(args.vault));
    const timeout = typeof args.timeout_ms === "number" ? args.timeout_ms : 2e4;
    cleanup(out);

    // 🔴 **두 모양을 나눠 둔다.**
    //
    // `outNative` 는 OS 에 넘기는 것 — argv · 존재 확인 · `statSync`.
    // `outUi` 는 응답에 담는 것 — 소비자가 경로를 `split("/")` 로 다룬다.
    //
    // ⚠️ 섞으면 **에러 없이** 어긋난다. 실측으로 걸렸다: 같은 응답 안에서
    //    `path` · `vault` 는 `/`, `out` 만 역슬래시였다.
    const outNative = path.resolve(out);
    const outUi = normPath(outNative);
    mkdirSync(path.dirname(outNative), { recursive: true });
    try {
      launchOpen({
        path: resolved.path,
        vault: resolved.vault,
        extraArgs: [
          "--render",
          resolved.path,
          "--render-vault",
          resolved.vault,
          "--render-out",
          outNative,
          "--render-format",
          format,
        ],
      });
    } catch (e) {
      if (e instanceof LaunchError)
        throw new LapisError("app_not_found", e.message, e.remedy ?? "");
      throw e;
    }
    if (!waitForFile(outNative, timeout)) {
      throw new LapisError(
        "app_timeout",
        `앱이 ${timeout}ms 안에 결과를 안 냈다`,
        // 🔴 **원인이 둘인데 하나만 말하면 맞는 것을 확인하고 막힌다.**
        //    실측: 앱이 떠 있는데도 "떠 있는지 확인할 것"이 나왔다 — 진짜 원인은 그 앱이
        //    `--render` 를 모르는 구버전이라는 것이었다. 옛 빌드는 모르는 인자를 조용히
        //    무시하고, 두 번째 프로세스는 argv 를 넘긴 뒤 그냥 끝난다. 아무도 실패를 안 쓴다.
        //
        //    ⚠️ 떠 있는 앱에게 버전을 물을 통로가 없다 — 네트워킹 코드가 없고 argv 는
        //    한 방향이다. CLI 의 `cache-info` 프로브는 헤드리스 확인이라 여기 못 쓴다.
        //    그래서 탐지 대신 두 원인을 다 적는다.
        "① 앱 버전이 3.10.0 이상인지 — 그 아래는 --render 를 모르고 조용히 무시한다. " +
          "② 앱이 떠 있는지 — 꺼져 있으면 켜지는 시간이 더 든다(timeout_ms 로 늘릴 수 있다).",
      );
    }
    const failure = readFailure(outNative);
    if (failure)
      throw new LapisError("export_failed", failure, "앱 쪽 로그를 볼 것");
    return {
      ...resolved,
      out: outUi,
      format: format,
      bytes: statSync(outNative).size,
    };
  },
};
/**
 * 결과 파일이 실패 보고인가.
 *
 * 🔴 앱은 실패해도 **같은 경로에** 쓴다(`write_render_failure`). 그걸 성공으로 읽으면
 * 부른 쪽이 에러 JSON 을 PNG 로 알고 넘어간다.
 */
function readFailure(file: string): string | null {
  try {
    if (statSync(file).size > 4096) return null;
    const raw = readFileSync(file, "utf-8");
    if (!raw.startsWith("{")) return null;
    const v = JSON.parse(raw);
    return v.ok === false ? (v.error ?? "앱이 실패를 보고했다") : null;
  } catch {
    return null;
  }
}
export const TOOLS: ToolDef[] = [
  openTool,
  revealTool,
  indexTool,
  statsTool,
  usageTool,
  exportTool,
  renderTool,
];
/**
 * 결과 파일이 생길 때까지 기다린다.
 *
 * ⚠️ **크기가 0 이면 아직이다.** 쓰는 중인 파일을 보고 끝났다 하면 잘린 것을 읽는다.
 *
 * ⚠️ MCP 서버는 stdio 를 잡고 있어 비동기 대기가 간단하지 않다 — 자식 프로세스로
 * 재운다. 바쁘 기다림보다 싸다.
 */
function waitForFile(file: string, timeoutMs: number, pollMs = 60): boolean {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (statSync(file).size > 0) return true;
    } catch {}
    if (Date.now() >= until) return false;
    spawnSync(process.execPath, ["-e", `setTimeout(()=>{}, ${pollMs})`]);
  }
}
/** 🔴 지난 실행의 파일이 남아 있으면 그걸 보고 **즉시 성공**이라 한다. */
function cleanup(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {}
}
