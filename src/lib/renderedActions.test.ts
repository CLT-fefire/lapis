import { describe, it, expect } from "vitest";
import { nextDir, compareCells, sortedOrder, toMarkdownTable, toCsv } from "./renderedActions";

/**
 * 렌더된 본문의 상호작용.
 *
 * 실측: 표가 **95/112 노트(85%)** 에 있다 — 이 vault 의 지배적 구조인데 아무 기능이
 * 없었다.
 */

describe("nextDir", () => {
  it("원문 → 오름 → 내림 → 원문", () => {
    expect(nextDir(null)).toBe("asc");
    expect(nextDir("asc")).toBe("desc");
    expect(nextDir("desc")).toBeNull();
  });
});

describe("compareCells", () => {
  /**
   * 🔴 **숫자처럼 보이면 숫자로.** 문자열 비교면 `10` 이 `9` 앞에 오고, 그건 표를
   * 정렬한 사람이 바로 알아채는 오답이다.
   */
  it("숫자를 숫자로 센다", () => {
    expect(compareCells("9", "10")).toBeLessThan(0);
    expect(compareCells("10", "9")).toBeGreaterThan(0);
  });

  it("천 단위 쉼표와 퍼센트도 숫자다", () => {
    expect(compareCells("1,000", "999")).toBeGreaterThan(0);
    expect(compareCells("9%", "10%")).toBeLessThan(0);
  });

  it("음수와 소수도", () => {
    expect(compareCells("-1", "0.5")).toBeLessThan(0);
  });

  it("숫자가 아니면 문자열로", () => {
    expect(compareCells("가", "나")).toBeLessThan(0);
  });

  /** ⚠️ 오름차순에서 빈 칸이 위에 몰리면 표가 안 읽힌다 — **항상 뒤로**. */
  it("빈 칸은 항상 뒤로", () => {
    expect(compareCells("", "가")).toBeGreaterThan(0);
    expect(compareCells("가", "")).toBeLessThan(0);
    expect(compareCells("", "")).toBe(0);
  });
});

describe("sortedOrder", () => {
  const rows = [
    ["나", "2"],
    ["가", "10"],
    ["다", "1"],
  ];

  it("원문 순서는 그대로", () => {
    expect(sortedOrder(rows, 0, null)).toEqual([0, 1, 2]);
  });

  it("오름차순", () => {
    expect(sortedOrder(rows, 0, "asc")).toEqual([1, 0, 2]);
  });

  it("내림차순", () => {
    expect(sortedOrder(rows, 0, "desc")).toEqual([2, 0, 1]);
  });

  it("숫자 열은 숫자로", () => {
    expect(sortedOrder(rows, 1, "asc")).toEqual([2, 0, 1]);
  });

  /** ⚠️ **안정 정렬** — 같은 값이 매번 다른 순서면 두 번 정렬한 결과가 달라진다. */
  it("동점은 원래 순서를 지킨다", () => {
    const same = [["같음"], ["같음"], ["같음"]];
    expect(sortedOrder(same, 0, "asc")).toEqual([0, 1, 2]);
    expect(sortedOrder(same, 0, "desc")).toEqual([0, 1, 2]);
  });

  it("칸이 모자란 행도 안 죽는다", () => {
    expect(() => sortedOrder([["a"], []], 0, "asc")).not.toThrow();
  });
});

describe("toMarkdownTable", () => {
  it("머리글과 구분선을 낸다", () => {
    const out = toMarkdownTable(["A", "B"], [["1", "2"]]);
    expect(out.split("\n")).toEqual(["| A | B |", "|---|---|", "| 1 | 2 |"]);
  });

  /** 🔴 셀의 `|` 를 안 막으면 붙여넣은 표의 **열이 하나 는다.** */
  it("셀 안의 파이프를 막는다", () => {
    expect(toMarkdownTable(["A"], [["가|나"]])).toContain("가\\|나");
  });

  it("셀 안의 개행을 공백으로", () => {
    expect(toMarkdownTable(["A"], [["가\n나"]])).toContain("가 나");
  });
});

describe("toCsv", () => {
  it("머리글과 행을 낸다", () => {
    expect(toCsv(["A", "B"], [["1", "2"]])).toBe("A,B\n1,2");
  });

  /** 🔴 RFC 4180 — 안 감싸면 스프레드시트에서 **열이 밀린다.** */
  it("쉼표가 든 셀을 감싼다", () => {
    expect(toCsv(["A"], [["가,나"]])).toBe('A\n"가,나"');
  });

  it("따옴표를 두 번 쓴다", () => {
    expect(toCsv(["A"], [['그는 "말했다"']])).toBe('A\n"그는 ""말했다"""');
  });

  it("개행이 든 셀도 감싼다", () => {
    expect(toCsv(["A"], [["가\n나"]])).toContain('"가\n나"');
  });

  it("평범한 셀은 안 감싼다", () => {
    expect(toCsv(["A"], [["보통"]])).toBe("A\n보통");
  });
});
