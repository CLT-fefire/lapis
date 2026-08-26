import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { COMMANDS } from "../cli/spec.ts";

/**
 * `QueryArgs` · MCP 도구 스키마 · CLI 옵션이 **같은 인자 집합**을 알고 있는지 고정한다.
 *
 * ## 왜 필요한가 — 셋이 손으로 맞춰져 있다
 *
 * ```
 * QueryArgs (타입)         mcp/query.ts     ← 구현이 실제로 받는 것
 * inputSchema (손 JSON)    mcp/server.ts    ← MCP 클라이언트가 보는 것
 * CLI 옵션                 cli/spec.ts      ← 터미널에서 쓸 수 있는 것
 * ```
 *
 * 인자를 타입과 구현에만 넣고 스키마에 빼먹으면 **MCP 클라이언트 쪽에서는 그 인자가
 * 존재하지 않는다.** 오류 없이 기능이 없는 것이 된다 — `CACHE_VERSION`이 앱과 MCP에서
 * 갈렸던 고장(#209)과 같은 부류다.
 *
 * 타입은 런타임에 지워지므로 소스를 문자열로 읽는다. `mcp/cacheVersion.test.ts` ·
 * `cli/headlessContract.test.ts`가 쓰는 것과 같은 방법이다.
 *
 * ## 단언이 비대칭인 이유
 *
 * - **표면이 `QueryArgs`에 없는 키를 노출하면 즉시 실패.** 그건 부르면 무시되는 인자다.
 * - **`QueryArgs`에 있는데 표면에 없는 키는 허용목록에 명시.** 일부러 안 내는 것이 실제로
 *   있고(`sources`), 명시를 요구하면 인자를 더할 때 "이건 CLI에 안 낸다"를 **의식적으로**
 *   적게 된다.
 */

const QUERY = "mcp/query.ts";
const SERVER = "mcp/server.ts";

/** `QueryArgs` 인터페이스 본문에서 키 이름을 뽑는다. */
function queryArgsKeys(): string[] {
  const src = readFileSync(QUERY, "utf8");
  const start = src.indexOf("export interface QueryArgs {");
  if (start === -1) throw new Error("QueryArgs 선언을 찾지 못했다");
  const end = src.indexOf("\n}", start);
  const body = src.slice(start, end);
  return [...body.matchAll(/^\s{2}([a-z_]+)\??:/gm)].map((m) => m[1]);
}

/** MCP 도구 스키마의 `properties` 키. */
function schemaKeys(): string[] {
  const src = readFileSync(SERVER, "utf8");
  const start = src.indexOf("properties: {");
  if (start === -1) throw new Error("inputSchema.properties를 찾지 못했다");
  const end = src.indexOf("\n    },", start);
  const body = src.slice(start, end);
  return [...body.matchAll(/^\s{6}([a-z_]+):\s*\{/gm)].map((m) => m[1]);
}

/**
 * `lapisQuery`를 부르는 명령들의 옵션 → `QueryArgs` 키.
 *
 * ⚠️ **질의를 거치는 명령만 본다.** `links --broken` · `replace --regex` 같은 것은 질의
 * 인자가 아니라 명령 전용 플래그다. 그걸 섞으면 제외 목록이 계속 자라고, 자라는 제외
 * 목록은 결국 가드를 무력화한다.
 *
 * spec은 실제 TS 모듈이므로 **정규식으로 읽지 않고 import 한다.** `QueryArgs`만 타입이라
 * 소스를 읽어야 한다.
 *
 * CLI는 하이픈, 질의 핵은 밑줄을 쓴다 — 표면이 갈리는 것은 의도다(다른 옵션이 전부
 * 하이픈인데 하나만 밑줄이면 손이 틀린다).
 */
const QUERY_BACKED = ["search", "backlinks", "list"] as const;

function cliOptionKeys(): string[] {
  const out: string[] = [];
  for (const name of QUERY_BACKED) {
    const cmd = COMMANDS.find((c) => c.name === name);
    if (!cmd) throw new Error(`spec에 없는 명령: ${name}`);
    for (const o of cmd.options) out.push(o.name.replace(/-/g, "_"));
  }
  return [...new Set(out)];
}
/**
 * 일부러 표면에 안 내는 `QueryArgs` 키.
 *
 * ⚠️ 여기 적는 것은 **결정**이다. 인자를 더하면서 이 목록에 넣는다면, 왜 안 내는지
 * 한 줄 남겨라.
 */
const NOT_ON_SURFACE: Record<string, string> = {
  // 어느 팔(구조/BM25)을 쓸지 고르는 것 — 디버깅용이라 사람 표면에 안 낸다.
  sources: "디버깅용. 사람이 고를 이유가 없다",
  // `--broken` · `--orphans`처럼 명령별 플래그로 나가는 것들.
  backlinks_of: "명령으로 나간다 (lapis backlinks)",
  list: "명령으로 나간다 (lapis list)",
  text: "위치 인자로 나간다 (lapis search <질의>)",
};

describe("인자 표면 계약", () => {
  it("스캐너가 실제로 키를 뽑는다 — 정규식 회귀 방지", () => {
    // ⚠️ 이게 없으면 정규식이 깨졌을 때 아래 단언들이 **빈 배열끼리 비교**하며 통과한다.
    expect(queryArgsKeys().length).toBeGreaterThanOrEqual(10);
    expect(schemaKeys().length).toBeGreaterThanOrEqual(8);
    expect(cliOptionKeys().length).toBeGreaterThanOrEqual(5);
  });

  it("MCP 스키마가 QueryArgs에 없는 인자를 노출하지 않는다", () => {
    const known = new Set(queryArgsKeys());
    for (const k of schemaKeys()) {
      expect(known, `구현이 모르는 스키마 인자: ${k}`).toContain(k);
    }
  });

  it("CLI가 QueryArgs에 없는 인자를 노출하지 않는다", () => {
    const known = new Set([...queryArgsKeys(), "limit", "vault"]);
    for (const k of cliOptionKeys()) {
      expect(known, `구현이 모르는 CLI 옵션: ${k}`).toContain(k);
    }
  });

  /** 여기가 #209의 자리다 — 타입과 구현에만 넣고 스키마에 빼먹는 것. */
  it("QueryArgs의 모든 인자가 MCP 스키마에 있다 (허용목록 제외)", () => {
    const inSchema = new Set(schemaKeys());
    const missing = queryArgsKeys().filter((k) => !inSchema.has(k) && !(k in NOT_ON_SURFACE));
    expect(missing, `스키마에 빠진 인자: ${missing.join(", ")}`).toEqual([]);
  });

  it("허용목록에 죽은 항목이 없다", () => {
    // 인자를 지웠는데 허용목록에 남으면, 다음에 같은 이름을 쓸 때 검사를 조용히 건너뛴다.
    const keys = new Set(queryArgsKeys());
    for (const k of Object.keys(NOT_ON_SURFACE)) {
      expect(keys, `QueryArgs에 없는 허용목록 항목: ${k}`).toContain(k);
    }
  });
});
