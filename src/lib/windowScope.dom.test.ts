import { describe, it, expect, beforeEach } from "vitest";
import { scopedKey, windowLabel, pruneOrphanScopedKeys } from "./windowScope";

/**
 * 창별 localStorage 키 — **테스트가 0이었다.**
 *
 * ⚠️ 여기가 틀리면 **보조 창이 main 의 키를 읽어 남의 vault 를 그대로 연다.**
 * 2026-08-10 에 실제로 났던 고장이고(라벨을 모듈 변수에 캐시했다), 화면은 멀쩡한데
 * 열린 vault 만 틀린다.
 *
 * Tauri 밖에서는 라벨이 `main` 으로 떨어진다 — 그래야 테스트가 기존 키를 그대로 보고
 * 브라우저 프리뷰도 동작한다. 그 fallback 자체를 여기서 고정한다.
 */

beforeEach(() => localStorage.clear());

describe("scopedKey", () => {
  /**
   * ⚠️ `main` 은 **접미사를 안 받는다.** 받게 하면 기존 사용자의 모든 창이 vault 를
   * 잊는다 — 저장값은 그대로 있는데 아무도 그 키를 안 읽는다.
   */
  it("main 창은 접미사 없는 원래 키", () => {
    expect(windowLabel()).toBe("main");
    expect(scopedKey("lapis.last-vault-path")).toBe("lapis.last-vault-path");
  });

  it("같은 base 는 항상 같은 키", () => {
    expect(scopedKey("a")).toBe(scopedKey("a"));
  });
});

describe("pruneOrphanScopedKeys", () => {
  /**
   * Tauri 는 재시작 때 config 의 `main` 만 만든다. 창을 열고 닫는 동안 쌓인
   * `<base>.wN` 키는 아무도 회수하지 않는다.
   */
  it("죽은 창의 키를 지운다", () => {
    localStorage.setItem("lapis.last-vault-path.w2", "/v/a");
    localStorage.setItem("lapis.last-vault-path.w3", "/v/b");
    pruneOrphanScopedKeys("lapis.last-vault-path");
    expect(localStorage.getItem("lapis.last-vault-path.w2")).toBeNull();
    expect(localStorage.getItem("lapis.last-vault-path.w3")).toBeNull();
  });

  /** ⚠️ 자기 키(접미사 없는 main)는 남아야 한다 — 지우면 main 이 vault 를 잊는다. */
  it("main 자신의 키는 안 지운다", () => {
    localStorage.setItem("lapis.last-vault-path", "/v/main");
    localStorage.setItem("lapis.last-vault-path.w2", "/v/other");
    pruneOrphanScopedKeys("lapis.last-vault-path");
    expect(localStorage.getItem("lapis.last-vault-path")).toBe("/v/main");
    expect(localStorage.getItem("lapis.last-vault-path.w2")).toBeNull();
  });

  /**
   * ⚠️ **접두사가 같은 다른 키를 건드리면 안 된다.** `lapis.last-vault-path` 를 청소하다가
   * `lapis.last-vault-path-backup` 을 지우면 조용히 다른 기능이 죽는다.
   */
  it("다른 base 의 키는 안 건드린다", () => {
    localStorage.setItem("lapis.other.w2", "x");
    localStorage.setItem("lapis.last-vault-path-backup", "y");
    pruneOrphanScopedKeys("lapis.last-vault-path");
    expect(localStorage.getItem("lapis.other.w2")).toBe("x");
    expect(localStorage.getItem("lapis.last-vault-path-backup")).toBe("y");
  });

  /**
   * ⚠️ 순회 중 삭제는 인덱스를 흔든다. 지울 것을 **먼저 모으고** 지워야 한다 —
   * 안 그러면 절반만 지워지고 아무도 모른다.
   */
  it("여러 개를 한 번에 다 지운다", () => {
    for (let i = 2; i <= 9; i++) localStorage.setItem(`k.w${i}`, String(i));
    pruneOrphanScopedKeys("k");
    const left = Object.keys(localStorage).filter((x) => x.startsWith("k."));
    expect(left, "순회 중 삭제로 절반만 지워졌다").toEqual([]);
  });

  it("지울 것이 없으면 아무 일도 없다", () => {
    localStorage.setItem("k", "v");
    pruneOrphanScopedKeys("k");
    expect(localStorage.getItem("k")).toBe("v");
  });
});
