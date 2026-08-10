import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import { openPalette, closePalette, paletteOpen, paletteHintMode, paletteIntent } from "./palette";

/**
 * ⌘P("잠깐 보기" = 활성 탭 교체)와 ⌘T("붙잡기" = 새 탭)를 가르는 건 `paletteIntent`
 * 하나뿐이다 — 두 단축키가 같은 파일 팔레트를 열기 때문에, 이 값이 잘못 남으면
 * **겉보기엔 멀쩡한데 탭만 조용히 다르게 쌓인다.**
 */
describe("openPalette — intent", () => {
  beforeEach(() => closePalette());

  it("기본은 new-tab — ⌘K 등 기존 경로의 동작을 바꾸지 않는다", () => {
    openPalette("all");
    expect(get(paletteIntent)).toBe("new-tab");
    expect(get(paletteHintMode)).toBe("all");
    expect(get(paletteOpen)).toBe(true);
  });

  it("⌘P는 replace로 연다", () => {
    openPalette("files", "replace");
    expect(get(paletteIntent)).toBe("replace");
    expect(get(paletteHintMode)).toBe("files");
  });

  it("⌘T는 같은 files 모드지만 new-tab", () => {
    openPalette("files", "new-tab");
    expect(get(paletteIntent)).toBe("new-tab");
    expect(get(paletteHintMode)).toBe("files");
  });

  it("replace로 열었다가 다시 기본으로 열면 intent가 남지 않는다", () => {
    openPalette("files", "replace");
    closePalette();
    openPalette("all");
    expect(get(paletteIntent)).toBe("new-tab");
  });
});
