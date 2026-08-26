import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * CLI가 앱에 넘기는 `--headless` 인자가 **Rust가 실제로 받는 것과 같은지** 고정한다.
 *
 * ## 왜 필요한가 — 여긴 프로세스 경계다
 *
 * `cli/indexRun.ts`가 넘기는 것은 그냥 문자열 배열이다. 타입 검사도, 링커도, 그 문자열이
 * 반대쪽에 존재하는지 확인해주지 않는다. Rust에서 `export-index`를 `dump-index`로 바꿔도
 * **모든 테스트가 통과한다.** 실패는 사용자가 `lapis index`를 실행한 순간에야 나온다.
 *
 * 같은 부류를 이미 겪었다: `CACHE_VERSION`이 앱과 MCP에서 갈렸고(#209), 잡은 방법은
 * **Rust 소스를 직접 읽는 가드**였다(`mcp/cacheVersion.test.ts`). 여기도 같은 방법이다.
 */

const RUST = "src-tauri/src/headless.rs";
const RUN = "cli/indexRun.ts";

function rustSource(): string {
  return readFileSync(RUST, "utf8");
}

/** Rust `parse`의 `match verb` 갈래에서 작업 이름을 뽑는다. */
function rustVerbs(): string[] {
  const src = rustSource();
  return [...src.matchAll(/^\s*"([a-z-]+)" => Ok\(Some\(Job::/gm)].map((m) => m[1]);
}

/** Rust `parse`의 `match key` 갈래에서 옵션 이름을 뽑는다. */
function rustOptions(): string[] {
  const src = rustSource();
  return [...src.matchAll(/^\s*"(--[a-z]+)" => \w+ = Some\(/gm)].map((m) => m[1]);
}

/** CLI가 실제로 넘기는 문자열 리터럴. */
function cliTokens(): string[] {
  const src = readFileSync(RUN, "utf8");
  return [...src.matchAll(/"(--headless|--vault|--in|--out|[a-z]+-index|cache-info)"/g)].map(
    (m) => m[1],
  );
}

describe("헤드리스 인자 계약", () => {
  it("스캐너가 실제로 뭔가를 뽑는다 — 정규식 회귀 방지", () => {
    // ⚠️ 이 검사가 없으면 정규식이 깨졌을 때 아래 단언들이 **빈 배열끼리 비교**하며
    // 조용히 통과한다. 실패할 수 없는 가드는 가드가 아니다.
    expect(rustVerbs().length).toBeGreaterThanOrEqual(3);
    expect(rustOptions().length).toBeGreaterThanOrEqual(3);
    expect(cliTokens().length).toBeGreaterThan(0);
  });

  it("CLI가 넘기는 작업 이름을 Rust가 전부 안다", () => {
    const verbs = new Set(rustVerbs());
    const used = cliTokens().filter((t) => t.endsWith("-index") || t === "cache-info");
    expect(used.length).toBeGreaterThan(0);
    for (const v of new Set(used)) {
      expect(verbs, `Rust가 모르는 작업: ${v}`).toContain(v);
    }
  });

  it("CLI가 넘기는 옵션을 Rust가 전부 안다", () => {
    const opts = new Set(rustOptions());
    const used = cliTokens().filter((t) => t.startsWith("--") && t !== "--headless");
    expect(used.length).toBeGreaterThan(0);
    for (const o of new Set(used)) {
      expect(opts, `Rust가 모르는 옵션: ${o}`).toContain(o);
    }
  });

  it("표식 문자열이 양쪽에서 같다", () => {
    const m = /const SENTINEL: &str = "(--[a-z]+)";/.exec(rustSource());
    expect(m, "headless.rs에서 SENTINEL 선언을 찾지 못했다").not.toBeNull();
    expect(cliTokens()).toContain(m![1]);
  });

  it("Rust가 아는 작업은 셋뿐이다 — 늘리면 CLI도 함께 봐야 한다", () => {
    // 이 단언은 "Rust에 작업을 더했는데 CLI 쪽을 잊었다"를 잡으려고 일부러 좁게 뒀다.
    expect(rustVerbs().sort()).toEqual(["cache-info", "export-index", "import-index"]);
  });
});
