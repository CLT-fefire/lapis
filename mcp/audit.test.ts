import { describe, it, expect, beforeEach } from "vitest";
import { lapisQuery, isAudit, resetState, AUDIT_KINDS } from "./query.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * MCP 에서 vault 위생을 묻는다.
 *
 * ## ⚠️ 왜 필요했나
 *
 * 감사가 앱에 5개 · CLI에 5개 · **MCP에 0개** 였다. AI가 검색은 하는데 "이 vault에서
 * 무엇이 깨졌나"를 못 물었다. 도구가 하나뿐인 것은 설계지만, 그 하나가 못 하는 일이
 * CLI엔 다섯 개 있는 것은 설계가 아니라 구멍이다.
 *
 * ⚠️ **판정은 공유한다.** `$lib/vaultAudit` 하나를 셋이 부른다 — MCP가 자기 판정을 따로
 * 두면 AI가 보는 상태와 사람이 보는 상태가 갈리고, 그러면 누가 맞는지 아무도 모른다.
 */

const SERVER = readFileSync(
  fileURLToPath(new URL("./server.ts", import.meta.url)),
  "utf-8",
);

describe("도구 스키마", () => {
  /** ⚠️ 스키마에 없으면 AI가 **존재를 모른다.** 구현만 있고 아무도 안 부른다. */
  it("audit 인자가 스키마에 있다", () => {
    expect(SERVER).toContain("audit: {");
    for (const k of AUDIT_KINDS) {
      expect(SERVER, `${k} 가 enum 에 없다`).toContain(`"${k}"`);
    }
  });

  /**
   * ⚠️ 비싼 것을 비싸다고 적는다 — 안 적으면 AI가 반복해서 부른다.
   *
   * ⚠️ **본문을 읽는 감사가 늘면 여기도 늘어야 한다.** v3.4.0 에서 `tasks` 가 붙었다.
   */
  it("본문을 읽는 감사가 느리다고 적혀 있다", () => {
    const i = SERVER.indexOf("audit: {");
    const block = SERVER.slice(i, i + 1200);
    for (const k of ["unlinked", "tasks"]) {
      expect(block, `${k} 가 비싸다는 말이 없다`).toMatch(
        new RegExp(`⚠️[^"]*${k}[^"]*본문을 전부 읽어`),
      );
    }
  });
});

describe("응답", () => {
  const VAULT = "C:/Projects/SharedDocs";
  const vaultPresent = (() => {
    try {
      return readFileSync(path.join(VAULT, "HOME.md"), "utf8").length > 0;
    } catch {
      return false;
    }
  })();

  beforeEach(() => resetState());

  /**
   * ⚠️ 실제 vault가 있는 머신에서만 돈다. **건너뛴 것을 통과로 세지 않기 위해** 조건을
   * 밖으로 드러낸다 — 다른 머신에서는 이 describe 가 통째로 skip 이라고 보인다.
   */
  const maybe = vaultPresent ? it : it.skip;

  for (const kind of AUDIT_KINDS) {
    maybe(`audit:"${kind}" 가 감사 응답을 낸다`, () => {
      const r = lapisQuery({ vault: VAULT, audit: kind });
      expect(isAudit(r)).toBe(true);
      if (!isAudit(r)) return;
      expect(r.audit).toBe(kind);
      expect(typeof r.count).toBe("number");
      expect(r.unit.length).toBeGreaterThan(0);
      expect(Array.isArray(r.rows)).toBe(true);
      // 상한을 넘겨 싣지 않는다 — 응답이 커지면 AI 맥락을 먹는다.
      expect(r.rows.length).toBeLessThanOrEqual(r.count);
    });
  }

  /**
   * ⚠️ **"무언가를 찾는지"는 단언하지 않는다.** 처음엔 `count > 0` 으로 뒀는데,
   * vault 의 frontmatter 분열을 실제로 고치자마자 이 테스트가 빨개졌다 — 코드가 아니라
   * **데이터**를 단언하고 있었던 것이다. 고치면 깨지는 테스트는 고치는 것을 막는다.
   *
   * 배선은 위 루프가 본다(다섯 종 전부 감사 응답을 내는지).
   */
  maybe("count 는 자르기 전 개수다", () => {
    const r = lapisQuery({ vault: VAULT, audit: "props" });
    if (!isAudit(r)) throw new Error("감사 응답을 기대했다");
    expect(r.count).toBeGreaterThanOrEqual(r.rows.length);
  });

  maybe("limit 이 rows 를 자른다", () => {
    const r = lapisQuery({ vault: VAULT, audit: "props", limit: 1 });
    if (!isAudit(r)) throw new Error("감사 응답을 기대했다");
    expect(r.rows.length).toBeLessThanOrEqual(1);
    // ⚠️ `count` 는 자르기 **전** 개수다. 자른 수를 세면 "다 봤다"로 읽힌다.
    expect(r.count).toBeGreaterThanOrEqual(r.rows.length);
  });
});

describe("조건 없음", () => {
  /**
   * ⚠️ 안내는 `message` 가 아니라 `remedy` 에 있다 — `LapisError` 가 둘을 나눠 든다.
   * `toThrow(/audit/)` 는 message 만 봐서 통과 못 한다.
   */
  it("audit 도 없고 다른 조건도 없으면 사용법에 audit 을 알려준다", () => {
    try {
      lapisQuery({});
      expect.unreachable("throw 했어야 한다");
    } catch (e) {
      expect((e as { remedy?: string }).remedy).toContain("audit");
    }
  });
});
