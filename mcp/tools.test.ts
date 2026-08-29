import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TOOLS } from "./tools.ts";

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
 * 🔴 `lapis_render` 는 **결과 파일을 먼저 지운다.**
 *
 * 지난 실행의 파일이 남아 있으면 그걸 보고 즉시 성공이라 한다 — 앱이 아무것도 안 했는데
 * "됐다"가 되고, 부른 쪽은 옛 그림을 새 그림으로 읽는다.
 */
describe("lapis_render", () => {
  it("기다리기 전에 옛 결과를 지운다", () => {
    const at = src.indexOf("cleanup(out)");
    const wait = src.indexOf("waitForFile(");
    expect(at).toBeGreaterThan(-1);
    expect(at, "지우기가 기다리기보다 뒤에 있다").toBeLessThan(wait);
  });

  /** ⚠️ 앱이 실패를 같은 경로에 JSON 으로 쓴다 — 그걸 성공으로 읽으면 안 된다. */
  it("실패 보고를 성공으로 안 읽는다", () => {
    expect(src).toMatch(/readFailure\(/);
    expect(src).toMatch(/v\.ok === false/);
  });

  /** 타임아웃만 주면 "느린 건지 안 뜬 건지"를 못 가른다. */
  it("타임아웃에 조치를 적는다", () => {
    expect(src).toMatch(/app_timeout/);
    expect(src).toMatch(/앱이 떠 있는지 확인할 것/);
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
    // 앱에 넘기는 argv 와 존재 확인·크기 재기는 native 여야 한다.
    expect(src).toMatch(/"--render-out",\s*outNative/);
    expect(src).toMatch(/waitForFile\(outNative/);
    expect(src).toMatch(/statSync\(outNative\)/);
    // ⚠️ 응답에 담기는 건 반대다.
    expect(src).toMatch(/out: outUi/);
  });
});
