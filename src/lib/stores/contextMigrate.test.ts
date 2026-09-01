import { describe, it, expect } from "vitest";
import { defaultContextTab, migrateContextTab } from "./context";

/**
 * 컨텍스트 패널 탭의 **이주** — 옛 저장 상태를 지금 모양으로.
 *
 * ## 🔴 왜 이 자리가 위험한가
 *
 * 이주는 **조용히 틀리기 좋은 자리**다. 틀려도 예외가 안 나고, 사용자에게는 "설정이
 * 날아갔다"로만 보인다. 어느 탭이 열리든 화면은 멀쩡해 보이므로 아무도 못 잡는다.
 *
 * 옛 상태는 불리언 묶음이었다(`{properties: true, outline: false, …}`). 지금은 키 하나다.
 * 원본 주석이 규칙을 적어 뒀다 — **열려 있던 첫 섹션**을 고른다. 아무거나 고르면
 * 사용자가 보던 것과 다른 탭으로 열린다.
 */

describe("이미 새 모양이면 그대로", () => {
  it("아는 키는 그대로 쓴다", () => {
    expect(migrateContextTab("outline")).toBe("outline");
    expect(migrateContextTab("properties")).toBe("properties");
  });

  /** ⚠️ 모르는 문자열은 기본값으로 — 저장된 값이 낡거나 손상됐을 수 있다. */
  it("모르는 키는 기본값", () => {
    expect(migrateContextTab("없는탭")).toBe(defaultContextTab());
    expect(migrateContextTab("")).toBe(defaultContextTab());
  });
});

describe("🔴 옛 불리언 묶음에서 옮긴다", () => {
  it("열려 있던 첫 섹션을 고른다", () => {
    expect(migrateContextTab({ properties: false, outline: true })).toBe("outline");
  });

  /**
   * ⚠️ **여럿 열려 있으면 첫 번째다.** 옛 패널은 여러 섹션을 동시에 펼칠 수 있었고,
   * 새 패널은 탭이라 하나만 고른다. 순서는 `CONTEXT_SECTION_KEYS` 가 정한다 —
   * "아무거나"가 되면 사용자가 보던 것과 다른 탭이 열린다.
   */
  it("여럿이면 정해진 순서의 첫 번째", () => {
    const got = migrateContextTab({ properties: true, outline: true });
    expect(got).toBe("properties");
  });

  it("전부 닫혀 있었으면 기본값", () => {
    expect(migrateContextTab({ properties: false, outline: false })).toBe(defaultContextTab());
  });

  it("빈 객체도 기본값", () => {
    expect(migrateContextTab({})).toBe(defaultContextTab());
  });

  /** ⚠️ `true` 가 아닌 참 같은 값은 안 받는다 — 옛 형식은 불리언이었다. */
  it("불리언이 아닌 값은 열린 것으로 안 본다", () => {
    expect(migrateContextTab({ outline: 1 as unknown as boolean })).toBe(defaultContextTab());
  });
});

describe("아무것도 없을 때", () => {
  /** 첫 실행 · 저장 실패 · 손상 — 셋 다 여기로 온다. 터지면 앱이 안 뜬다. */
  it("null · undefined · 숫자 · 배열에도 안 터진다", () => {
    for (const raw of [null, undefined, 0, 42, [], [1, 2], true]) {
      expect(migrateContextTab(raw)).toBe(defaultContextTab());
    }
  });
});
