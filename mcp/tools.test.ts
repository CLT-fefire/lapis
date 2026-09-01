import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import nodePath from "node:path";
import { homedir, tmpdir } from "node:os";
import { TOOLS, defaultHtmlPath } from "./tools.ts";

/**
 * MCP 도구들 — 질의 하나였던 것이 여덟이 됐다.
 *
 * ## ⚠️ 스키마와 실행이 갈리면 조용히 죽는다
 *
 * 도구 정의를 한 곳, 실행을 다른 곳에 두면 추가할 때 한쪽만 하고 만다 — 그러면
 * **목록에는 보이는데 부르면 죽는다.** `TOOLS` 한 표가 둘 다 갖는 이유이고,
 * 여기서 그 표를 검사한다.
 */

const src = readFileSync(fileURLToPath(new URL("./tools.ts", import.meta.url)), "utf-8");
const server = readFileSync(fileURLToPath(new URL("./server.ts", import.meta.url)), "utf-8");

describe("표가 온전하다", () => {
  it("도구마다 이름 · 설명 · 스키마 · 실행이 있다", () => {
    for (const t of TOOLS) {
      expect(t.name, "이름").toMatch(/^lapis_[a-z_]+$/);
      expect(t.description.length, `${t.name} 설명`).toBeGreaterThan(40);
      expect(t.inputSchema, `${t.name} 스키마`).toHaveProperty("type", "object");
      expect(typeof t.run, `${t.name} 실행`).toBe("function");
    }
  });

  it("이름이 겹치지 않는다", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  /** ⚠️ 질의 도구는 `server.ts` 가 갖는다 — 여기 또 넣으면 목록에 둘이 뜬다. */
  it("질의 도구가 여기 없다", () => {
    expect(TOOLS.map((t) => t.name)).not.toContain("lapis_query");
  });

  it("필수 인자를 스키마가 밝힌다", () => {
    const byName = new Map(TOOLS.map((t) => [t.name, t]));
    expect((byName.get("lapis_open")!.inputSchema as { required: string[] }).required).toContain("note");
    expect((byName.get("lapis_render")!.inputSchema as { required: string[] }).required).toEqual(
      expect.arrayContaining(["note", "out"]),
    );
  });
});

/**
 * 🔴 **게이트는 하나여야 한다.**
 *
 * 도구마다 검사하게 두면 새 도구가 하나 빠뜨려져도 아무도 모른다 — 그게 게이트를
 * 무력화하는 가장 쉬운 길이다. `server.ts` 가 호출 직전에 **한 번** 본다.
 */
describe("게이트", () => {
  it("서버가 호출마다 한 곳에서 본다", () => {
    expect(server).toMatch(/const gate = readMcpGate\(\);/);
    expect(server).toMatch(/if \(!gate\.enabled\) throw mcpDisabledError\(gate\);/);
    // 실행보다 **앞**이어야 한다 — 뒤면 이미 일어난 뒤에 막는 셈이다.
    const gateAt = server.indexOf("readMcpGate()");
    const runAt = server.indexOf("tool.run(args)");
    expect(gateAt).toBeGreaterThan(-1);
    expect(runAt).toBeGreaterThan(gateAt);
  });

  /** ⚠️ 도구가 게이트를 자기 안에서 또 보면, 한 곳을 고쳐도 다른 곳이 남는다. */
  it("도구가 게이트를 따로 안 본다", () => {
    expect(src, "도구 안에서 게이트를 본다").not.toMatch(/readMcpGate/);
  });
});

/**
 * ⚠️ **vault 쓰기는 여기 없다.** 노트 만들기·찾아 바꾸기는 CLI 3층에 둔다 —
 * 되돌리기 비용이 다르고, 나중에 얹을 수는 있어도 되돌릴 수는 없다.
 */
describe("쓰기 도구가 없다", () => {
  it("만들기·치환·태그 이름 바꾸기가 없다", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).not.toContain("lapis_new");
    expect(names).not.toContain("lapis_replace");
    expect(names).not.toContain("lapis_tag_rename");
  });

  /** `lapis_render` · `lapis_export_html` 은 **밖으로** 쓴다 — vault 를 안 고친다. */
  it("내보내기는 vault 밖으로만 쓴다", () => {
    expect(src).toMatch(/writeFileSync\(out,/);
    expect(src, "vault 안의 노트를 덮어쓴다").not.toMatch(/writeFileSync\(resolved\.path/);
  });
});

/**
 * `lapis_render` — **요청 조립·대기·실패 판정은 여기 없다.**
 *
 * ## 🔴 왜 옮겼나
 *
 * CLI 에도 같은 기능이 필요해졌는데, 그대로 두면 argv 이름·타임아웃·실패 판정이
 * **세 곳(Rust · MCP · CLI)** 에 흩어진다. 이 저장소에서 가장 자주 나온 결함이
 * "규칙이 두 곳에 있어 갈린 것"이다.
 *
 * 그래서 `ops/renderRequest.ts` 한 곳에 두고 둘이 부른다. 그 규칙들(옛 결과 먼저
 * 지우기 · 크기 0 은 아직 · 실패 보고 가려내기 · 두 원인을 다 말하기)은
 * `ops/renderRequest.test.ts` 가 지킨다. 여기서는 **두 벌이 안 생겼는지**만 본다.
 *
 * ⚠️ `ops/` 로 내린 이유 — cli 도 mcp 도 **둘 다 앱의 클라이언트**다. 한쪽 지붕 밑에
 * 두면 다른 쪽이 그걸 부르느라 순환이 생긴다.
 *
 * 실측 근거: 리팩터 뒤 CLI 와 MCP 가 같은 노트에서 **정확히 같은 16,765 바이트**를 냈다.
 */
describe("lapis_render", () => {
  it("공유 모듈에 맡긴다", () => {
    expect(src).toMatch(/requestRender\(/);
    expect(src).toMatch(/from "\.\.\/ops\/renderRequest\.ts"/);
  });

  /** ⚠️ 옮긴 것을 여기 다시 적으면 두 벌이 된다 — 옮긴 의미가 사라진다. */
  it("대기·판정을 다시 안 적는다", () => {
    expect(src, "대기 루프가 남아 있다").not.toMatch(/function waitForFile/);
    expect(src, "실패 판정이 남아 있다").not.toMatch(/function readFailure/);
    expect(src, "지우기가 남아 있다").not.toMatch(/function cleanup/);
  });

  /** 형식 목록도 공유한다 — Rust 의 `FORMATS` 와 짝을 맞춘 자리가 거기다. */
  it("형식 목록을 공유한다", () => {
    expect(src).toMatch(/RENDER_FORMATS/);
  });

  /** ⚠️ 실패 종류는 그대로 MCP 오류로 넘어가야 한다 — 삼키면 성공으로 읽힌다. */
  it("실패를 그대로 올린다", () => {
    expect(src).toMatch(/if \(!r\.ok\) throw new LapisError\(r\.kind, r\.message, r\.remedy\)/);
  });
});

/**
 * 🔴 **프런트로 나가는 경로는 `/` 하나다.**
 *
 * `CLAUDE.md` 가 Rust 쪽에 `to_ui()` 를, MCP 쪽에 `normPath()` 를 못 박아 둔 이유가
 * 있다. 소비자가 경로를 `split("/")` 로 다루기 때문에 한 곳만 `\` 가 새도 파일명·부모
 * 디렉터리 표시가 통째로 어긋난다 — **에러 없이.**
 *
 * 실측: `lapis_render` 응답이 `path` · `vault` 는 `/`, `out` 만 `C:\Users\...` 를 냈다.
 * 같은 응답 안에서 두 모양이 섞였다.
 */
describe("경로는 한 모양으로 나간다", () => {
  it("응답에 담기는 경로가 normPath 를 통과한다", () => {
    // `path.resolve` 결과를 그대로 응답에 넣는 자리가 없어야 한다.
    expect(src, "resolve 결과가 정규화 없이 응답에 들어간다").not.toMatch(
      /^\s*out: path\.resolve\(out\),\s*$/m,
    );
    expect(src).toMatch(/normPath\(/);
  });

  /** ⚠️ **비교·파일 접근에는 정규화한 문자열을 쓰지 않는다.** OS 에 넘기는 건 native 여야 한다. */
  it("파일 접근은 native 경로로 한다", () => {
    // 공유 모듈에 넘기는 것은 native, 응답에 담는 것은 `/` 다.
    expect(src).toMatch(/outNative,\s*format\s*\}/);
    expect(src).toMatch(/out: outUi/);
  });
});

/**
 * 🔴 **응답에 담기는 경로는 전부 `/` 다.**
 *
 * `lapis_render` 의 `out` 하나만 고쳤더니 같은 결함이 다른 도구에 그대로 남아 있었다 —
 * 실제 MCP 클라이언트로 불러 보고 나왔다:
 *
 * - `lapis_usage` 의 `dir` → `C:\Users\...\usage`
 * - `lapis_open` 의 `app` → 실행파일 native 경로
 *
 * 한 자리를 고치고 끝내면 나머지는 **다음에 누가 걸릴 때까지** 남는다. 그래서 도구별이
 * 아니라 **나가는 자리 전부**를 본다.
 */
describe("경로가 새는 곳이 없다", () => {
  it("usage 의 dir 을 정규화한다", () => {
    expect(src, "native dir 이 그대로 나간다").not.toMatch(/return \{ dir, months,/);
    expect(src).toMatch(/dir: normPath\(dir\)/);
  });

  it("open 의 app 을 정규화한다", () => {
    expect(src, "native exe 경로가 그대로 나간다").not.toMatch(/app: exe\b/);
    expect(src).toMatch(/app: normPath\(exe\)/);
  });

  it("export 의 out 을 정규화한다", () => {
    expect(src).toMatch(/out: normPath\(out\)/);
  });
});

/**
 * 🔴 **내보내기 기본값이 vault 를 더럽히면 안 된다.**
 *
 * `defaultHtmlPath` 가 노트 **옆에** `.html` 을 뒀다 — 즉 vault 안이다. 이 모듈은
 * "vault 밖으로만 쓴다"고 선언해 놓고 기본 경로가 그걸 어겼다.
 *
 * ⚠️ 조용한 부작용이다: 앱이 감시 중이면 그 쓰기가 재색인을 부르고, 사용자는 자기가
 * 안 만든 파일이 vault 에 쌓이는 것을 나중에야 본다.
 */
describe("내보내기 기본 경로", () => {
  /**
   * 🔴 **동작으로 본다.** 예전 테스트는 `path.join(dir, ...)` 라는 **변수 이름**을 봤는데,
   * `dir` 이 가리키는 곳만 바꾸면 이름은 그대로라 통과해 버렸다 — 고쳤는데도 빨갛거나,
   * 더 나쁘게는 안 고쳤는데 초록이 된다.
   */
  it("노트가 있는 폴더 밖으로 나간다", () => {
    const note = nodePath.join("C:", "vault", "sub", "노트.md");
    const out = defaultHtmlPath(note);
    expect(nodePath.dirname(nodePath.resolve(out))).not.toBe(
      nodePath.dirname(nodePath.resolve(note)),
    );
  });

  it("노트 이름은 지킨다", () => {
    expect(nodePath.basename(defaultHtmlPath("/vault/어떤 노트.md"))).toBe("어떤 노트.html");
  });

  /**
   * ⚠️ `markdown` 은 **노트 확장자가 아니다.** 인덱서(`vault.rs`)가 안 받는다.
   * 예전엔 여기서 그것까지 벗겼는데, 생산자가 안 만드는 것을 소비자가 벗기는
   * 비대칭이었다. 규칙은 이제 `notePath.ts` 하나다.
   */
  it("확장자를 벗긴다", () => {
    for (const ext of ["md", "mmd", "MD"]) {
      expect(nodePath.basename(defaultHtmlPath(`/v/x.${ext}`)), ext).toBe("x.html");
    }
  });

  /** vault 밖의 사람이 찾을 수 있는 자리 — 없으면 임시 폴더로 물러난다. */
  it("사용자 폴더 아니면 임시 폴더다", () => {
    const dir = nodePath.resolve(nodePath.dirname(defaultHtmlPath("/v/x.md")));
    const ok = [nodePath.resolve(homedir(), "Downloads"), nodePath.resolve(tmpdir())];
    expect(ok).toContain(dir);
  });

  /** ⚠️ 어디에 썼는지 응답이 말해야 한다 — 안 그러면 찾으러 다녀야 한다. */
  it("어디 썼는지 응답에 담는다", () => {
    expect(src).toMatch(/out: normPath\(out\)/);
  });
});

/**
 * 🔴 **`app_timeout` 의 조치문이 한 원인만 말했다.**
 *
 * 실측: 앱이 **떠 있는데도** "앱이 떠 있는지 확인할 것"이 나왔다. 진짜 원인은 떠 있는 앱이
 * `--render` 를 **모르는 구버전**이라는 것이었다 — 옛 빌드는 모르는 인자를 조용히 무시하고,
 * 두 번째 프로세스는 argv 를 넘긴 뒤 그냥 종료한다. 아무도 실패를 안 쓴다.
 *
 * 조치문이 첫 원인만 단정하면 부른 쪽은 **맞는 것을 확인하고 막힌다.** 원인에서 한참 떨어진
 * 신호이고, 이 저장소가 가장 싫어하는 부류다.
 *
 * ## ⚠️ 왜 버전을 물어보지 않나
 *
 * 떠 있는 앱에게 물을 통로가 없다 — 이 프로젝트에는 **네트워킹 코드가 없고**, argv 는
 * 한 방향이다. CLI 의 `cache-info` 프로브는 **헤드리스** 확인이라 떠 있는 인스턴스에는
 * 못 쓴다(single-instance 가 삼킨다). 그래서 탐지 대신 **정직한 조치문**을 고른다.
 */
describe("app_timeout 조치문", () => {
  /** ⚠️ 조치문 본문은 `cli/renderRequest.ts` 에 있다 — CLI 도 같은 말을 해야 한다. */
  it("두 원인을 다 말한다", () => {
    const rr = readFileSync(
      fileURLToPath(new URL("../ops/renderRequest.ts", import.meta.url)),
      "utf-8",
    );
    // ⚠️ 타입 선언(`kind: "app_timeout";`)이 아니라 **구현부**를 찾는다. 앞의 것을
    //    집으면 조치문이 없는 자리를 보고 운다.
    const at = rr.indexOf('kind: "app_timeout",');
    expect(at, "구현부를 못 찾았다").toBeGreaterThan(-1);
    const around = rr.slice(at, at + 1200);
    expect(around, "앱이 안 떠 있는 경우").toMatch(/떠 있는지/);
    expect(around, "버전이 낮은 경우").toMatch(/3\.10/);
  });

  /** ⚠️ 도구 설명에도 있어야 한다 — LLM 은 조치문보다 설명을 먼저 읽는다. */
  it("도구 설명이 최소 버전을 밝힌다", () => {
    const render = TOOLS.find((t) => t.name === "lapis_render")!;
    expect(render.description).toMatch(/3\.10/);
  });
});
