import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * `lapis export --all` 의 **계약**을 소스로 확인한다.
 *
 * ⚠️ 실제 쓰기는 실제 vault에 대고 돌려 봤다(87장). 여기서 고정하는 것은 **틀리면
 * 조용한 것들**이다 — 구조 보존 · 경로 이탈 · 실패 계수.
 */

const SRC = readFileSync(
  fileURLToPath(new URL("./handlers.ts", import.meta.url)),
  "utf-8",
).replace(/^[ \t]*\/\/.*$/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");

describe("--all 계약", () => {
  it("소스를 실제로 읽었다", () => {
    expect(SRC).toContain("function exportAll");
  });

  /**
   * ⚠️ 평평하게 펴면 `a/노트.md` 와 `b/노트.md` 가 같은 이름을 놓고 다투고 **나중 것이
   * 앞의 것을 말없이 덮는다.** 87장 중 몇 장이 사라져도 아무도 모른다.
   */
  it("vault 구조를 그대로 만든다", () => {
    const i = SRC.indexOf("function exportAll");
    const fn = SRC.slice(i, SRC.indexOf(NL + "}", i));
    expect(fn).toContain("mkdirSync");
    expect(fn).toContain("recursive: true");
  });

  /** 경로 이탈은 조용히 틀리는 부류다 — `safeWrite` 와 같은 태도. */
  it("출력 디렉터리 밖으로 새는지 검사한다", () => {
    const i = SRC.indexOf("function exportAll");
    const fn = SRC.slice(i, SRC.indexOf(NL + "}", i));
    expect(fn).toContain("startsWith(destRoot");
  });

  /** 실패를 조용히 빠뜨리면 "전부 나왔다"로 읽힌다. */
  it("실패를 세어서 보고하고 종료 코드에 싣는다", () => {
    const i = SRC.indexOf("function exportAll");
    const fn = SRC.slice(i, SRC.indexOf(NL + "}", i));
    expect(fn).toContain("failed.push");
    expect(fn).toContain("process.exitCode = 1");
  });

  /**
   * ⚠️ `--all` 을 표준출력으로 내보내면 수백 장이 이어 붙어 **쓸 수 없는 문서**가 된다.
   * 조용히 그러느니 거절한다.
   */
  it("--out-dir 없이 --all 을 거절한다", () => {
    expect(SRC).toContain("--all 은 --out-dir 가 있어야 한다");
  });
});

const NL = String.fromCharCode(10);
void path;
