import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CACHE_VERSION } from "./cache.ts";

/**
 * MCP가 기대하는 캐시 버전이 **앱이 쓰는 버전과 같은지** 고정한다.
 *
 * ## 왜 다른 테스트로는 못 잡나
 *
 * `mcp/fixture.ts`는 캐시를 **이 상수로** 쓰고 MCP도 **이 상수로** 읽는다. 그래서 둘은
 * 늘 일치하고, **앱과의 어긋남은 구조적으로 검출되지 않는다.** 픽스처를 아무리 늘려도
 * 마찬가지다 — 같은 값을 양쪽에 쓰는 한 진실은 하나뿐인 것처럼 보인다.
 *
 * 실제로 v8(fingerprint 해시 명세화)에서 Rust만 올라가고 여기가 7로 남은 채 릴리스됐다.
 * 증상은 **모든 질의가 `version_skew`** 다 — 캐시가 멀쩡한데 도구가 통째로 죽는다.
 * 테스트는 전부 초록이었다.
 *
 * 그래서 이 테스트만 **Rust 소스를 직접 읽는다.** 두 진실을 대조하는 유일한 자리다.
 */
describe("CACHE_VERSION", () => {
  const rustVersion = (): number => {
    const rs = readFileSync("src-tauri/src/search_cache.rs", "utf8");
    const m = /pub const CACHE_VERSION:\s*u32\s*=\s*(\d+)\s*;/.exec(rs);
    if (!m) throw new Error("search_cache.rs에서 CACHE_VERSION 선언을 찾지 못했다");
    return Number(m[1]);
  };

  it("앱(Rust)과 MCP(TS)가 같은 값을 쓴다", () => {
    expect(CACHE_VERSION).toBe(rustVersion());
  });

  it("스캐너가 실제로 숫자를 뽑는다 — 정규식 회귀 방지", () => {
    // 정규식이 깨져 `rustVersion()`이 조용히 NaN이 되면 위 단언이 무의미해진다.
    const v = rustVersion();
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThan(0);
  });
});
