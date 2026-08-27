import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findLapisRanges } from "./editorLapisSyntax";

/**
 * 편집기의 lapis 문법 표시.
 *
 * ⚠️ **모르는 종류를 다르게 내는 것이 요점이다.** 아는 것만 칠하면 `[!WARN]` 같은 오타는
 * 그냥 안 칠해진 글자라 눈에 안 띈다 — 저장하고 미리보기로 넘어가서야 안다.
 */

const kinds = (t: string) => findLapisRanges(t).map((r) => r.kind);
const slice = (t: string) => findLapisRanges(t).map((r) => t.slice(r.from, r.to));

describe("콜아웃", () => {
  it("아는 종류를 잡는다", () => {
    expect(kinds("> [!WARNING]")).toEqual(["callout"]);
    expect(slice("> [!WARNING]")).toEqual(["[!WARNING]"]);
  });

  it("대소문자를 안 따진다", () => {
    expect(kinds("> [!warning]")).toEqual(["callout"]);
  });

  /** ⚠️ 이게 이 기능의 이유다. */
  it("모르는 종류를 **다르게** 낸다", () => {
    expect(kinds("> [!WARN]")).toEqual(["callout-unknown"]);
    expect(kinds("> [!QUESTION]")).toEqual(["callout-unknown"]);
  });

  it("들여쓴 인용문도 잡는다", () => {
    expect(kinds("   >  [!TIP]")).toEqual(["callout"]);
  });

  it("인용문이 아니면 안 잡는다", () => {
    expect(kinds("[!WARNING] 그냥 글자")).toEqual([]);
  });

  /** 표식은 문단 **첫 줄**에만 뜻이 있다 — 미리보기 규칙과 같다. */
  it("줄 머리가 아니면 안 잡는다", () => {
    expect(kinds("> 앞말 [!WARNING]")).toEqual([]);
  });
});

describe("임베드", () => {
  it("`![[…]]` 를 통째로 잡는다", () => {
    expect(slice("앞 ![[노트]] 뒤")).toEqual(["![[노트]]"]);
  });

  it("앵커까지 포함한다", () => {
    expect(slice("![[노트#헤딩]]")).toEqual(["![[노트#헤딩]]"]);
  });

  it("한 줄에 둘이면 둘 다", () => {
    expect(kinds("![[가]] 와 ![[나]]")).toEqual(["embed", "embed"]);
  });

  /** 느낌표 없는 위키링크는 대상이 아니다 — 그건 이미 다른 색이 있다. */
  it("평범한 위키링크는 안 잡는다", () => {
    expect(kinds("[[노트]]")).toEqual([]);
  });
});

describe("오프셋", () => {
  it("여러 줄에서 문서 기준 오프셋을 낸다", () => {
    const text = "첫 줄\n> [!TIP]\n![[노트]]";
    const rs = findLapisRanges(text);
    expect(rs).toHaveLength(2);
    expect(text.slice(rs[0].from, rs[0].to)).toBe("[!TIP]");
    expect(text.slice(rs[1].from, rs[1].to)).toBe("![[노트]]");
  });

  /**
   * ⚠️ CodeMirror 의 `RangeSetBuilder` 는 **오름차순**을 요구한다. 한 줄에 둘이 섞이면
   * 넣은 순서가 뒤집힌다 — 정렬을 빼면 편집기가 던진다.
   */
  it("항상 오름차순이다", () => {
    const rs = findLapisRanges("> [!TIP] 그리고 ![[노트]]");
    expect(rs.map((r) => r.from)).toEqual([...rs.map((r) => r.from)].sort((a, b) => a - b));
  });

  it("빈 문서는 빈 목록", () => {
    expect(findLapisRanges("")).toEqual([]);
  });
});

describe("⚠️ 편집기에 실제로 걸려 있다", () => {
  /**
   * 구간 찾기는 위에서 고정했다. 고정이 안 닿는 곳은 **확장을 등록했는가** 다 —
   * 안 걸면 아무 에러 없이 편집기가 예전 그대로다.
   *
   * ⚠️ CodeMirror 를 happy-dom 에 띄워 데코레이션을 읽는 방법도 있지만, CM 은 실제
   * 레이아웃을 요구하는 곳이 많아 **\"안 돌았는데 통과\"** 가 되기 쉽다. 이 저장소가
   * `resolve.conditions` 로 이미 한 번 데인 방식이다. 소스를 읽는 쪽이 정직하다.
   */
  const SRC = readFileSync(
    fileURLToPath(new URL("./Editor.svelte", import.meta.url)),
    "utf-8",
  ).replace(/^[ \t]*\/\/.*$/gm, " ");

  it("확장과 테마가 둘 다 등록돼 있다", () => {
    expect(SRC.length).toBeGreaterThan(500);
    expect(SRC).toContain("lapisSyntaxExtension()");
    expect(SRC).toContain("lapisSyntaxTheme");
  });

  /** 세 종류 전부 색이 있어야 한다 — 하나라도 빠지면 그 종류만 조용히 안 보인다. */
  it("세 종류에 전부 스타일이 있다", () => {
    for (const cls of ["cm-lapis-callout", "cm-lapis-callout-unknown", "cm-lapis-embed"]) {
      expect(SRC, cls).toContain(cls);
    }
  });

  /** ⚠️ 모르는 종류는 **색 말고도** 표시가 있어야 한다 — 색만 다르면 넘어간다. */
  it("모르는 콜아웃은 밑줄까지 붙는다", () => {
    const i = SRC.indexOf("cm-lapis-callout-unknown");
    const block = SRC.slice(i, SRC.indexOf("}", i));
    expect(block).toContain("textDecoration");
  });
});
