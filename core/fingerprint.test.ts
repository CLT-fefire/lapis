import { describe, it, expect } from "vitest";
import { fingerprintOf } from "./cache.ts";

/**
 * ⚠️ **이 벡터는 `src-tauri/src/vault.rs`의 테스트와 같다.**
 *
 * 두 구현이 갈라지면 MCP가 매 질의를 `changed`로 답하기 시작한다 — 캐시가 멀쩡해도
 * "낡았다"고 말하는 셈이라, 실패가 요란하지 않고 **조용히 쓸모없어진다.**
 * 한쪽을 고치면 반드시 다른 쪽 테스트도 같은 값으로 맞춰야 한다.
 */
describe("fingerprintOf — Rust와 같은 값", () => {
  it("빈 vault", () => {
    expect(fingerprintOf([])).toBe("811c9dc5811c9dc5");
  });

  it("알려진 벡터 2건", () => {
    expect(
      fingerprintOf([
        { rel: "a.md", mtimeMs: 1000, size: 10 },
        { rel: "sub/b.md", mtimeMs: 2000, size: 20 },
      ]),
    ).toBe("2216189fc167911f");
  });

  it("한글 경로 — UTF-8 바이트로 먹인다", () => {
    expect(fingerprintOf([{ rel: "노트/가.md", mtimeMs: 1, size: 2 }])).toBe("2ab6d98d37d5ce41");
  });

  it("항상 16자리 hex", () => {
    expect(fingerprintOf([{ rel: "x", mtimeMs: 0, size: 0 }])).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("fingerprintOf — 무엇을 잡아내는가", () => {
  const base = [{ rel: "a.md", mtimeMs: 1000, size: 10 }];

  it("mtime 변경", () => {
    expect(fingerprintOf([{ rel: "a.md", mtimeMs: 1001, size: 10 }])).not.toBe(
      fingerprintOf(base),
    );
  });

  it("size 변경 — mtime 보존 in-place 쓰기가 이 경로다", () => {
    // 프록시(mtime 비교)가 놓치던 바로 그 변경. fingerprint는 size로 잡는다.
    expect(fingerprintOf([{ rel: "a.md", mtimeMs: 1000, size: 11 }])).not.toBe(
      fingerprintOf(base),
    );
  });

  it("삭제", () => {
    const two = [...base, { rel: "b.md", mtimeMs: 1000, size: 10 }];
    expect(fingerprintOf(two)).not.toBe(fingerprintOf(base));
  });

  it("필드 자리바꿈에 속지 않는다 — 두 줄기를 쓰는 이유", () => {
    expect(fingerprintOf([{ rel: "10", mtimeMs: 1000, size: 5 }])).not.toBe(
      fingerprintOf([{ rel: "5", mtimeMs: 1000, size: 10 }]),
    );
  });
});
