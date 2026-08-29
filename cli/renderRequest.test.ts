import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RENDER_FORMATS, renderArgs, type RenderFormat } from "./renderRequest.ts";

/**
 * 앱에 렌더를 시키는 요청 — **MCP 와 CLI 가 나눠 쓴다.**
 *
 * ## 🔴 왜 한 곳에 두나
 *
 * `lapis_render` 를 만들고 나서 CLI 에는 그 짝이 없었다. CLI 의 `export` 는 브라우저
 * 없는 자체 변환기라 mermaid 가 코드 펜스로 남는다. 같은 일을 CLI 쪽에 다시 적으면
 * **argv 이름·타임아웃·실패 판정이 세 곳(Rust · MCP · CLI)에 흩어진다.**
 *
 * 이 저장소에서 가장 자주 나온 결함이 "규칙이 두 곳에 있어 갈린 것"이다. 그래서 요청
 * 조립과 대기·판정을 여기 한 번만 적고 둘이 부른다.
 */

const src = readFileSync(fileURLToPath(new URL("./renderRequest.ts", import.meta.url)), "utf-8");
const tools = readFileSync(fileURLToPath(new URL("../mcp/tools.ts", import.meta.url)), "utf-8");
const handlers = readFileSync(fileURLToPath(new URL("./handlers.ts", import.meta.url)), "utf-8");

describe("argv 이름은 한 곳에서 나온다", () => {
  it("Rust 가 읽는 이름 그대로 만든다", () => {
    const a = renderArgs({
      notePath: "C:/v/n.md",
      vault: "C:/v",
      outNative: "C:/out/n.png",
      format: "png",
    });
    expect(a).toEqual([
      "--render",
      "C:/v/n.md",
      "--render-vault",
      "C:/v",
      "--render-out",
      "C:/out/n.png",
      "--render-format",
      "png",
    ]);
  });

  /**
   * 🔴 **플래그 문자열을 소비자가 직접 적으면 안 된다.**
   *
   * 실제로 한 번 당했다 — 손으로 `--render-note` 라고 쳤더니 Rust 의 `parse_render` 가
   * `None` 을 돌려주고 **아무 로그도 안 남긴 채** 조용히 지나갔다. 부른 쪽은
   * 타임아웃으로만 알았다.
   */
  it("MCP · CLI 가 플래그를 직접 안 적는다", () => {
    for (const [label, s] of [
      ["MCP", tools],
      ["CLI", handlers],
    ] as const) {
      expect(s, `${label} 가 argv 를 직접 조립한다`).not.toMatch(/"--render-vault"/);
      expect(s, `${label} 가 argv 를 직접 조립한다`).not.toMatch(/"--render-format"/);
    }
  });
});

describe("형식", () => {
  it("html · png 둘뿐이다", () => {
    expect([...RENDER_FORMATS]).toEqual(["html", "png"]);
  });

  /** ⚠️ Rust 의 `FORMATS` 와 같아야 한다. 갈리면 앱이 조용히 아무것도 안 한다. */
  it("Rust 와 같은 목록이다", () => {
    const rs = readFileSync(
      fileURLToPath(new URL("../src-tauri/src/clirender.rs", import.meta.url)),
      "utf-8",
    );
    const m = /const FORMATS: \[&str; \d+\] = \[([^\]]+)\]/.exec(rs);
    expect(m, "Rust 의 FORMATS 를 못 찾았다").toBeTruthy();
    const rust = m![1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
    expect(rust.sort()).toEqual([...RENDER_FORMATS].sort());
  });

  it("타입이 목록에서 나온다", () => {
    const f: RenderFormat = "png";
    expect(RENDER_FORMATS as readonly string[]).toContain(f);
  });
});

/**
 * 🔴 대기 전에 **옛 결과를 지운다.**
 *
 * 지난 실행의 파일이 남아 있으면 그걸 보고 즉시 성공이라 한다 — 앱이 아무것도 안 했는데
 * "됐다"가 되고, 부른 쪽은 옛 그림을 새 그림으로 읽는다.
 */
describe("대기 규칙", () => {
  it("지우기가 기다리기보다 앞이다", () => {
    // ⚠️ 인자 이름을 못 박지 않는다 — 바꾸면 개선을 막는 검사가 된다.
    const clean = src.search(/\bcleanup\([\w.]+\)/);
    const wait = src.search(/\bwaitForFile\([\w.]+,/);
    expect(clean, "지우는 자리를 못 찾았다").toBeGreaterThan(-1);
    expect(wait, "기다리는 자리를 못 찾았다").toBeGreaterThan(-1);
    expect(clean).toBeLessThan(wait);
  });

  /** ⚠️ 크기 0 인 파일은 **쓰는 중**이다. 그걸 완성으로 읽으면 잘린 것을 낸다. */
  it("크기 0 은 아직으로 본다", () => {
    expect(src).toMatch(/\.size > 0/);
  });

  /** ⚠️ 앱이 실패를 같은 경로에 JSON 으로 쓴다 — 성공으로 읽으면 안 된다. */
  it("실패 보고를 가려낸다", () => {
    expect(src).toMatch(/ok === false/);
  });
});
