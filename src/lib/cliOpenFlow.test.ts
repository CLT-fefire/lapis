import { describe, it, expect } from "vitest";
import { claimModeFor, isCliOpenWindow, vaultArgFor } from "./cliOpenFlow";

describe("cli open — 누가 받나", () => {
  it("자기 vault를 인자로 묻는다", () => {
    expect(claimModeFor({ isCliOpenWindow: false, vault: "/v" })).toEqual({
      kind: "vault",
      vault: "/v",
    });
  });

  it("CLI가 만든 창은 무엇이든 받는다", () => {
    expect(claimModeFor({ isCliOpenWindow: true, vault: null })).toEqual({ kind: "fresh" });
  });

  /**
   * ⚠️ vault 없는 평범한 창이 물으면 `vault: null`이 되고, Rust는 그걸 "무엇이든 달라"로
   * 읽는다. 그러면 **남을 위한 노트를 가로채고** 정작 그 vault를 연 창은 못 받는다.
   */
  it("vault 없는 평범한 창은 묻지 않는다", () => {
    expect(claimModeFor({ isCliOpenWindow: false, vault: null })).toEqual({ kind: "skip" });
    expect(claimModeFor({ isCliOpenWindow: false, vault: "" })).toEqual({ kind: "skip" });
  });

  it("CLI 표식이 있으면 vault가 이미 있어도 fresh다", () => {
    // 표식이 붙은 창은 그 일 하나를 위해 만들어졌다. 복원된 vault보다 그쪽이 우선이다.
    expect(claimModeFor({ isCliOpenWindow: true, vault: "/other" })).toEqual({ kind: "fresh" });
  });

  it("fresh만 null로 묻는다", () => {
    expect(vaultArgFor({ kind: "fresh" })).toBeNull();
    expect(vaultArgFor({ kind: "vault", vault: "/v" })).toBe("/v");
  });
});

describe("cli open — 창 표식 판정", () => {
  it("표식을 알아본다", () => {
    expect(isCliOpenWindow("?cli-open=1")).toBe(true);
    expect(isCliOpenWindow("?a=b&cli-open=1")).toBe(true);
  });

  it("표식이 없거나 값이 다르면 평범한 창이다", () => {
    for (const s of ["", "?", "?a=b", "?cli-open=0", "?cli-open=", "?clopen=1"]) {
      expect(isCliOpenWindow(s), `search=${s}`).toBe(false);
    }
  });
});
