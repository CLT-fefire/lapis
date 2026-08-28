import { describe, it, expect } from "vitest";
import {
  displayName,
  sameSearch,
  upsert,
  remove,
  parseSaved,
  SAVED_SEARCH_MAX,
  type SavedSearch,
} from "./savedSearch";

/**
 * 저장된 검색.
 *
 * 한눈에 보기에는 **저장뷰**가 있는데 검색에는 없었다 — 같은 질문을 매일 다시 조립했다.
 */

const s = (over: Partial<SavedSearch> = {}): SavedSearch => ({
  name: "",
  query: "조용한 실패",
  mode: "fulltext",
  scope: null,
  ...over,
});

describe("displayName", () => {
  it("이름이 있으면 이름", () => {
    expect(displayName(s({ name: "내 검색" }))).toBe("내 검색");
  });

  it("이름이 비면 질의", () => {
    expect(displayName(s())).toBe("조용한 실패");
  });

  it("둘 다 비면 표시용 문구", () => {
    expect(displayName(s({ query: "  " }))).toBe("(빈 검색)");
  });
});

describe("sameSearch — 이름이 아니라 내용", () => {
  /**
   * ⚠️ 이름으로 보면 같은 질의를 이름만 바꿔 여러 번 저장하게 된다. 내용으로 보면
   * 이름 고치기가 자연스럽게 "덮어쓰기"가 된다.
   */
  it("이름이 달라도 내용이 같으면 같다", () => {
    expect(sameSearch(s({ name: "A" }), s({ name: "B" }))).toBe(true);
  });

  it("스코프가 다르면 다르다", () => {
    expect(sameSearch(s(), s({ scope: "knowledge/lapis/" }))).toBe(false);
  });

  it("모드가 다르면 다르다", () => {
    expect(sameSearch(s(), s({ mode: "files" }))).toBe(false);
  });

  it("질의의 앞뒤 공백은 무시한다", () => {
    expect(sameSearch(s({ query: " x " }), s({ query: "x" }))).toBe(true);
  });
});

describe("upsert", () => {
  it("새 것은 맨 앞으로", () => {
    const list = [s({ query: "옛것" })];
    expect(upsert(list, s({ query: "새것" }))[0].query).toBe("새것");
  });

  /** ⚠️ 같은 내용을 다시 저장하면 **늘지 않고** 이름만 바뀌며 앞으로 온다. */
  it("같은 내용은 덮어쓰고 앞으로", () => {
    const list = [s({ query: "a" }), s({ query: "b" })];
    const out = upsert(list, s({ query: "b", name: "이름 붙임" }));
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("이름 붙임");
  });

  /** ⚠️ 상한이 없으면 팔레트가 저장된 검색으로 덮인다. */
  it("상한을 넘으면 오래된 것부터 나간다", () => {
    let list: SavedSearch[] = [];
    for (let i = 0; i < SAVED_SEARCH_MAX + 5; i++) list = upsert(list, s({ query: `q${i}` }));
    expect(list).toHaveLength(SAVED_SEARCH_MAX);
    expect(list[0].query).toBe(`q${SAVED_SEARCH_MAX + 4}`);
  });
});

describe("remove", () => {
  it("내용이 같은 것을 지운다", () => {
    const list = [s({ query: "a" }), s({ query: "b" })];
    expect(remove(list, s({ query: "a", name: "다른 이름" })).map((x) => x.query)).toEqual(["b"]);
  });

  it("없는 것을 지워도 안 죽는다", () => {
    expect(remove([s()], s({ query: "없음" }))).toHaveLength(1);
  });
});

describe("parseSaved", () => {
  it("정상 목록을 읽는다", () => {
    const raw = [{ name: "n", query: "q", mode: "files", scope: "a/" }];
    expect(parseSaved(raw)).toEqual([{ name: "n", query: "q", mode: "files", scope: "a/" }]);
  });

  /** ⚠️ 한 항목이 깨졌다고 전부 잃으면 목록을 저장한 뜻이 사라진다. */
  it("못 읽는 항목만 버리고 나머지는 살린다", () => {
    const raw = [null, { query: "살아남음" }, 3, { name: "질의 없음" }];
    expect(parseSaved(raw).map((x) => x.query)).toEqual(["살아남음"]);
  });

  it("모르는 모드는 all 로", () => {
    expect(parseSaved([{ query: "q", mode: "텔레파시" }])[0].mode).toBe("all");
  });

  /**
   * ⚠️ 빈 문자열 스코프는 `null` 이어야 한다. `""` 접두사는 **전부 통과**라 스코프가
   * 없는 것과 같은데, 화면에는 걸린 것처럼 보인다.
   */
  it("빈 스코프는 null", () => {
    expect(parseSaved([{ query: "q", scope: "" }])[0].scope).toBeNull();
    expect(parseSaved([{ query: "q", scope: "   " }])[0].scope).toBeNull();
  });

  it("배열이 아니면 빈 목록", () => {
    for (const bad of [null, undefined, {}, "x", 3]) expect(parseSaved(bad)).toEqual([]);
  });

  it("상한을 넘으면 자른다", () => {
    const raw = Array.from({ length: SAVED_SEARCH_MAX + 10 }, (_, i) => ({ query: `q${i}` }));
    expect(parseSaved(raw)).toHaveLength(SAVED_SEARCH_MAX);
  });
});
