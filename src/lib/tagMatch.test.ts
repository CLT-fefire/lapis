import { describe, it, expect } from "vitest";
import { normTag, tagMatches, noteHasTag, noteHasAnyTag } from "./tagMatch";

/**
 * 태그 매칭 — **한 규칙**을 셋이 쓴다(앱 필터 · 저장된 질의 · `core/query.ts` 의 `tag` 축).
 *
 * 🔴 모으기 전에는 둘이 달랐다: 질의 엔진은 NFC 만, 태그 인덱스는 소문자까지.
 * 그래서 `subject/UI` 와 `subject/ui` 를 한쪽은 같은 태그로, 다른 쪽은 다른 태그로 봤다.
 */

describe("정규형", () => {
  it("앞뒤 공백을 턴다", () => {
    expect(normTag("  tech  ")).toBe("tech");
  });

  it("대소문자를 가리지 않는다", () => {
    expect(normTag("Subject/UI")).toBe("subject/ui");
  });

  /** ⚠️ 한글은 자모가 분리된 형태로 들어올 수 있다 — NFC 로 맞춘다. */
  it("한글을 NFC 로 맞춘다", () => {
    const decomposed = "한글".normalize("NFD");
    expect(decomposed).not.toBe("한글");
    expect(normTag(decomposed)).toBe("한글");
  });
});

describe("걸리는 것", () => {
  it("정확히 같으면 걸린다", () => {
    expect(tagMatches("tech", "tech")).toBe(true);
  });

  it("대소문자가 달라도 걸린다", () => {
    expect(tagMatches("Subject/UI", "subject/ui")).toBe(true);
    expect(tagMatches("subject/ui", "SUBJECT/UI")).toBe(true);
  });

  /** nested — `tech` 로 물으면 `tech/*` 가 다 걸린다. */
  it("상위로 물으면 하위가 걸린다", () => {
    expect(tagMatches("tech/rust", "tech")).toBe(true);
    expect(tagMatches("tech/rust/async", "tech")).toBe(true);
    expect(tagMatches("tech/rust/async", "tech/rust")).toBe(true);
  });
});

describe("🔴 안 걸려야 하는 것", () => {
  /** ⚠️ `/` 경계를 요구한다. 안 그러면 `tech` 가 `technology` 를 잡는다. */
  it("접두사이기만 하면 안 걸린다", () => {
    expect(tagMatches("technology", "tech"), "`/` 경계 없이 걸렸다").toBe(false);
    expect(tagMatches("techno/beat", "tech")).toBe(false);
  });

  /**
   * 🔴 **방향이 있다.** 좁혀 물었는데 넓은 것이 걸리면 안 된다 —
   * `tech/rust` 로 물었는데 `tech` 만 달린 노트가 나오면 질의가 거짓말한 것이다.
   */
  it("하위로 물으면 상위는 안 걸린다", () => {
    expect(tagMatches("tech", "tech/rust")).toBe(false);
  });

  it("빈 질의는 아무것도 안 잡는다", () => {
    expect(tagMatches("tech", "")).toBe(false);
    expect(tagMatches("tech", "   ")).toBe(false);
  });

  it("다른 태그는 안 걸린다", () => {
    expect(tagMatches("subject/ui", "subject/cli")).toBe(false);
  });
});

describe("노트 단위", () => {
  const tags = ["lapis", "subject/UI", "tech/rust"];

  it("하나라도 걸리면 참", () => {
    expect(noteHasTag(tags, "subject")).toBe(true);
    expect(noteHasTag(tags, "tech/rust")).toBe(true);
  });

  it("없으면 거짓", () => {
    expect(noteHasTag(tags, "slate")).toBe(false);
  });

  it("태그가 없는 노트도 터지지 않는다", () => {
    expect(noteHasTag(undefined, "tech")).toBe(false);
    expect(noteHasTag([], "tech")).toBe(false);
  });

  describe("여럿 중 하나 (같은 축은 OR)", () => {
    it("하나라도 걸리면 참", () => {
      expect(noteHasAnyTag(tags, ["slate", "tech"])).toBe(true);
    });

    it("전부 안 걸리면 거짓", () => {
      expect(noteHasAnyTag(tags, ["slate", "obsidian"])).toBe(false);
    });

    /**
     * 🔴 **안 고른 축은 안 거른다.** 거짓으로 두면 태그를 안 고른 질의가 통째로 사라진다 —
     * `filterRows` · `applyFilters` 가 쓰는 계약과 같아야 한다.
     */
    it("빈 목록은 참 — 축을 안 고른 것이다", () => {
      expect(noteHasAnyTag(tags, [])).toBe(true);
      expect(noteHasAnyTag([], [])).toBe(true);
    });
  });
});
