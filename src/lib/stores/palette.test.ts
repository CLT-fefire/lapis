import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  openPalette,
  openPaletteAtLastMode,
  setPaletteMode,
  closePalette,
  paletteOpen,
  paletteHintMode,
  paletteIntent,
  lastPaletteMode,
} from "./palette";

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

/**
 * `⌘K` 가 **마지막 모드**로 연다 — 3.0.
 *
 * ⚠️ 여기서 조용히 틀리는 방법이 둘이다: 순환 밖 모드(`tag`·`facet`)를 기억해서 다음
 * `⌘K` 에 재현하거나(입력창은 빈데 태그만 나온다), 아무것도 기억 못 하고 늘 `all` 을
 * 내거나(그러면 이 기능은 없는 것이다). 아래 마지막 카나리아가 후자를 잡는다.
 */
describe("openPaletteAtLastMode — 마지막 모드 기억", () => {
  beforeEach(() => closePalette());

  it("전문 모드로 쓰던 뒤 ⌘K 는 전문 모드로 연다", () => {
    openPalette("fulltext");
    closePalette();
    openPaletteAtLastMode();
    expect(get(paletteHintMode)).toBe("fulltext");
  });

  it("순환 밖 모드는 기억하지 않는다", () => {
    openPalette("files");
    closePalette();
    setPaletteMode("tag");
    expect(get(lastPaletteMode)).toBe("files");
  });

  it("intent 는 따로 간다 — 모드를 기억해도 탭 정책은 인자가 정한다", () => {
    openPalette("fulltext");
    closePalette();
    openPaletteAtLastMode("replace");
    expect(get(paletteIntent)).toBe("replace");
    expect(get(paletteHintMode)).toBe("fulltext");
  });

  /** ⚠️ 카나리아 — 늘 기본값을 내면 위 단언들이 우연히 맞을 수 있다. */
  it("기억하는 값이 실제로 갈린다", () => {
    const seen = new Set<string>();
    for (const mode of ["all", "files", "fulltext", "command"] as const) {
      setPaletteMode(mode);
      seen.add(get(lastPaletteMode));
    }
    expect(seen).toEqual(new Set(["all", "files", "fulltext", "command"]));
  });
});
