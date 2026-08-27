import { describe, it, expect } from "vitest";
import {
  matchWikilinkPrefix,
  matchAnchorPrefix,
  buildHeadingCompletions,
  computeAnchorInsert,
  makeWikilinkCompletionSource,
} from "./wikilinkComplete";
import type { HeadingInfo } from "$lib/markdownPlugins/headingAnchor";

/**
 * `[[노트#헤딩]]` 자동완성.
 *
 * ## ⚠️ 왜 필요한가
 *
 * #246이 앵커 **문법**을 만들었는데 **입력**을 안 만들었다. 트리거 정규식이 `#`을 이름의
 * 일부로 봐서, `[[boundary-contracts#` 를 치는 순간 질의가 `boundary-contracts#` 이 되고
 * **후보가 0이 된다.**
 *
 * 헤딩 이름을 정확히 외워서 손으로 쳐야 하면 아무도 안 쓴다.
 */

const h = (text: string, slug: string, level = 2): HeadingInfo => ({
  level,
  text,
  slug,
  line: 0,
});

describe("matchAnchorPrefix", () => {
  it("`[[노트#` 이후를 헤딩 질의로 본다", () => {
    // `앞`0 ` `1 `[`2 `[`3 `노`4 `트`5 `#`6 `헤`7 — 질의는 7 에서 시작한다.
    expect(matchAnchorPrefix("앞 [[노트#헤")).toEqual({
      from: 7,
      note: "노트",
      query: "헤",
    });
  });

  it("`#` 바로 뒤(빈 질의)도 잡는다 — 그때 전체 목록을 보여줘야 한다", () => {
    expect(matchAnchorPrefix("[[노트#")?.query).toBe("");
  });

  /** `[[#헤딩]]` — 같은 문서 안. 노트 이름이 빈 문자열이다. */
  it("이름 없이 앵커만도 잡는다", () => {
    expect(matchAnchorPrefix("[[#헤")).toEqual({ from: 3, note: "", query: "헤" });
  });

  it("`#` 이 없으면 null", () => {
    expect(matchAnchorPrefix("[[노트")).toBeNull();
  });

  /** 별칭 구간에서는 자동완성을 끈다 — 이름 완성과 같은 규칙이다. */
  it("별칭을 치기 시작하면 안 잡는다", () => {
    expect(matchAnchorPrefix("[[노트#헤딩|별")).toBeNull();
  });

  it("닫힌 링크 뒤에서는 안 잡는다", () => {
    expect(matchAnchorPrefix("[[노트#헤딩]] 그리고")).toBeNull();
  });

  /** 헤딩 텍스트에 `#`이 또 있을 수 있다 — 첫 `#`에서 가른다. */
  it("두 번째 # 은 질의의 일부", () => {
    expect(matchAnchorPrefix("[[노트#C#")).toEqual({ from: 5, note: "노트", query: "C#" });
  });
});

describe("⚠️ 이름 완성과 겹치지 않는다", () => {
  /**
   * 둘 다 잡으면 후보 두 종류가 한 목록에 섞인다. 앵커 쪽이 이기고, 노트가 해소되지
   * 않을 때만 이름 완성으로 떨어진다(`C#.md` 같은 이름을 위해서다).
   */
  it("이름 완성은 여전히 `#` 을 포함한 문자열을 낸다", () => {
    expect(matchWikilinkPrefix("[[C#")?.query).toBe("C#");
  });
});

describe("buildHeadingCompletions", () => {
  const HS = [h("어떤 헤딩", "어떤-헤딩"), h("Another One", "another-one"), h("겹치는 말", "겹치는-말")];

  it("빈 질의면 전부 낸다", () => {
    expect(buildHeadingCompletions("", HS)).toHaveLength(3);
  });

  it("헤딩 글자로 거른다", () => {
    expect(buildHeadingCompletions("어떤", HS).map((c) => c.label)).toEqual(["어떤 헤딩"]);
  });

  it("대소문자를 안 따진다", () => {
    expect(buildHeadingCompletions("another", HS).map((c) => c.label)).toEqual(["Another One"]);
  });

  /** 앞에서 맞는 것이 위로 — 사람이 앞부터 친다. */
  it("접두 일치가 부분 일치보다 위", () => {
    const out = buildHeadingCompletions("는", [h("는 시작", "는-시작"), h("겹치는 말", "겹치는-말")]);
    expect(out[0].label).toBe("는 시작");
  });

  it("안 맞으면 빈 목록", () => {
    expect(buildHeadingCompletions("zzz", HS)).toEqual([]);
  });

  /** ⚠️ 레벨을 보여준다 — 같은 낱말이 h2와 h4에 다 있으면 어느 쪽인지 알아야 한다. */
  it("레벨을 detail 로 낸다", () => {
    expect(buildHeadingCompletions("어떤", HS)[0].detail).toContain("2");
  });
});

describe("computeAnchorInsert", () => {
  it("닫는 괄호가 없으면 붙인다", () => {
    // 커서는 `]]` **뒤**다 — 이름 완성(`computeWikilinkInsert`)과 같은 규칙.
    expect(computeAnchorInsert("헤딩", "")).toEqual({ insert: "헤딩]]", cursorRel: 4 });
  });

  it("이미 닫혀 있으면 중복하지 않는다", () => {
    expect(computeAnchorInsert("헤딩", "]]")).toEqual({ insert: "헤딩", cursorRel: 4 });
  });
});

describe("⚠️ 소스가 실제로 앵커 분기를 탄다", () => {
  /**
   * 순수 함수만 테스트하면 **"만들었는데 안 쓴다"** 를 못 잡는다. 실제로 소스에서 앵커
   * 분기를 통째로 껐는데 위 16건이 전부 통과했다. 그래서 소스를 직접 부른다.
   */
  const HS = [h("어떤 헤딩", "어떤-헤딩"), h("둘째", "둘째", 3)];
  const NOTES = [{ stem: "노트", title: null, aliases: [] }];

  /** CodeMirror 없이 부를 수 있는 최소 컨텍스트 — 한 줄짜리 문서. */
  const ctx = (text: string) =>
    ({
      pos: text.length,
      state: {
        doc: { lineAt: () => ({ from: 0 }) },
        sliceDoc: (from: number, to: number) => text.slice(from, to),
      },
    }) as never;

  const source = (headings: readonly HeadingInfo[] | null = HS) =>
    makeWikilinkCompletionSource(
      () => NOTES,
      async () => headings,
    );

  it("`[[노트#` 이면 헤딩을 낸다", async () => {
    const r = await source()(ctx("[[노트#"));
    expect(r?.options.map((o) => o.label)).toEqual(["어떤 헤딩", "둘째"]);
    // 질의 시작이 `#` 바로 뒤여야 한다 — 아니면 고른 헤딩이 이름을 덮어쓴다.
    expect(r?.from).toBe(5);
  });

  it("`[[` 만이면 노트 이름을 낸다", async () => {
    const r = await source()(ctx("[[노"));
    expect(r?.options.map((o) => o.label)).toEqual(["노트"]);
  });

  /**
   * ⚠️ 노트가 해소되지 않으면 **이름 완성으로 떨어진다.** `C#.md` 같은 이름을 위해서다 —
   * 해소 규칙(`resolverKey`)과 같은 우선순위.
   */
  it("헤딩을 못 얻으면 이름 완성으로 떨어진다", async () => {
    const r = await source(null)(ctx("[[노트#"));
    expect(r).toBeNull();
    const r2 = await makeWikilinkCompletionSource(
      () => [{ stem: "C#", title: null, aliases: [] }],
      async () => null,
    )(ctx("[[C#"));
    expect(r2?.options.map((o) => o.label)).toEqual(["C#"]);
  });

  it("헤딩 조회를 안 주면 앵커 분기가 아예 안 돈다", async () => {
    const r = await makeWikilinkCompletionSource(() => NOTES)(ctx("[[노트#"));
    // 이름 완성이 `노트#` 로 검색해 아무것도 못 찾는다 — 예전 동작 그대로.
    expect(r).toBeNull();
  });
});
