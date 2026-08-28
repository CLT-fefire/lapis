import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  inDocSearch,
  openSearch,
  applySearch,
  closeSearch,
  setQuery,
  setMatchInfo,
  setRegexError,
  toggleOption,
  resetSearch,
  isOpenFor,
} from "./inDocSearch";

/**
 * 문서 내 검색 상태 — **테스트가 0이었다.**
 *
 * ⚠️ 여기서 조용히 틀리는 지점은 **옵션의 출처**다. `⌘⇧G`(vault 전체 찾기) 결과에서
 * 넘어올 때는 그쪽 옵션을 그대로 쓰는데, 그걸 영속화하면 **다음에 `⌘F` 를 열었을 때
 * 남의 설정이 들어와 있다.** 에러는 없고 검색 결과만 달라진다.
 */

beforeEach(() => {
  localStorage.clear();
  resetSearch();
});

describe("열기·닫기", () => {
  it("대상과 함께 연다", () => {
    openSearch("preview");
    expect(get(inDocSearch).open).toBe(true);
    expect(isOpenFor("preview")).toBe(true);
    expect(isOpenFor("editor")).toBe(false);
  });

  /** ⚠️ 닫으면 질의가 비어야 한다 — 안 그러면 다음에 열 때 옛 하이라이트가 남는다. */
  it("닫으면 질의와 매치 정보가 지워진다", () => {
    openSearch("preview");
    setQuery("cat");
    setMatchInfo(3, 2);
    closeSearch();
    const s = get(inDocSearch);
    expect(s.open).toBe(false);
    expect(s.query).toBe("");
    expect(s.total).toBe(0);
    expect(s.current).toBe(0);
  });

  it("닫혀 있으면 어느 대상으로도 열려 있지 않다", () => {
    expect(isOpenFor("preview")).toBe(false);
    expect(isOpenFor("editor")).toBe(false);
  });
});

describe("매치 정보", () => {
  /** `current` 는 1-based, 0 은 "매치 없음"이다 — 0-based 로 읽으면 첫 매치가 안 보인다. */
  it("0 은 매치 없음", () => {
    setMatchInfo(0, 0);
    expect(get(inDocSearch).current).toBe(0);
    setMatchInfo(5, 1);
    expect(get(inDocSearch).current).toBe(1);
  });

  it("정규식 오류를 따로 든다", () => {
    setRegexError(true);
    expect(get(inDocSearch).regexError).toBe(true);
    setRegexError(false);
    expect(get(inDocSearch).regexError).toBe(false);
  });
});

describe("옵션", () => {
  it("토글하면 뒤집힌다", () => {
    const before = get(inDocSearch).options.caseSensitive;
    toggleOption("caseSensitive");
    expect(get(inDocSearch).options.caseSensitive).toBe(!before);
  });

  it("토글은 영속화된다", () => {
    toggleOption("wholeWord");
    expect(localStorage.length, "저장이 안 되면 다음 기동에 취향이 사라진다").toBeGreaterThan(0);
  });
});

describe("applySearch — 인계", () => {
  it("질의·옵션·대상을 한 번에 세운다", () => {
    applySearch("cat", { caseSensitive: true, wholeWord: true, regex: false }, "editor");
    const s = get(inDocSearch);
    expect(s.open).toBe(true);
    expect(s.query).toBe("cat");
    expect(s.target).toBe("editor");
    expect(s.options.caseSensitive).toBe(true);
  });

  /**
   * 🔴 **인계된 옵션을 영속화하면 안 된다.** 이건 한 번의 인계이지 사용자가 문서 내
   * 검색에서 고른 취향이 아니다 — 덮어쓰면 다음 `⌘F` 에 남의 설정이 들어와 있다.
   */
  it("인계된 옵션은 저장하지 않는다", () => {
    localStorage.clear();
    applySearch("cat", { caseSensitive: true, wholeWord: true, regex: true }, "preview");
    expect(
      localStorage.length,
      "인계 옵션이 저장되면 다음 ⌘F 가 남의 설정으로 열린다",
    ).toBe(0);
  });

  /** ⚠️ 넘겨받은 객체를 그대로 들면 호출부가 나중에 고쳤을 때 같이 바뀐다. */
  it("옵션 객체를 복사해서 든다", () => {
    const opts = { caseSensitive: false, wholeWord: false, regex: false };
    applySearch("cat", opts, "preview");
    opts.caseSensitive = true;
    expect(get(inDocSearch).options.caseSensitive).toBe(false);
  });

  it("이전 매치 정보를 지운다", () => {
    setMatchInfo(9, 4);
    applySearch("cat", { caseSensitive: false, wholeWord: false, regex: false }, "preview");
    expect(get(inDocSearch).total).toBe(0);
    expect(get(inDocSearch).current).toBe(0);
  });
});
