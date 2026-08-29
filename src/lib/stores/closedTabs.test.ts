import { describe, it, expect, beforeEach } from "vitest";
import { pushClosed, popClosed, clearClosed, peekClosed, CLOSED_MAX } from "./tabs";

/**
 * 닫은 탭 되살리기.
 *
 * ## ⚠️ 저장하지 않는다
 *
 * 재기동 뒤에 되살릴 것은 **열린 탭**이지 닫은 탭이 아니다. 저장하면 어제 닫은 것이
 * 오늘 되살아나서, 되살리기를 눌렀을 때 무엇이 나올지 예측이 안 된다.
 */

beforeEach(() => {
  clearClosed();
});

describe("쌓고 꺼내기", () => {
  it("가장 최근 것부터 나온다", () => {
    pushClosed("/v/a.md");
    pushClosed("/v/b.md");
    expect(popClosed()).toBe("/v/b.md");
    expect(popClosed()).toBe("/v/a.md");
  });

  it("비었으면 null", () => {
    expect(popClosed()).toBeNull();
  });

  it("빈 경로는 안 쌓는다", () => {
    pushClosed("");
    expect(popClosed()).toBeNull();
  });

  /**
   * 🔴 **같은 경로가 여럿 쌓이면 되살리기가 제자리를 맴돈다.** 한 노트를 열었다 닫았다
   * 두 번 하면, 되살리기를 두 번 눌러야 그 이전 것이 나온다 — 고장으로 보인다.
   */
  it("같은 경로는 하나만 — 최근 자리로", () => {
    pushClosed("/v/a.md");
    pushClosed("/v/b.md");
    pushClosed("/v/a.md");
    expect(peekClosed()).toEqual(["/v/b.md", "/v/a.md"]);
    expect(popClosed()).toBe("/v/a.md");
    expect(popClosed()).toBe("/v/b.md");
    expect(popClosed()).toBeNull();
  });
});

describe("끝없이 안 자란다", () => {
  it("상한을 넘으면 오래된 것부터 나간다", () => {
    for (let i = 0; i < CLOSED_MAX + 5; i++) pushClosed(`/v/${i}.md`);
    const all = peekClosed();
    expect(all).toHaveLength(CLOSED_MAX);
    expect(all[0]).toBe(`/v/5.md`);
    expect(all.at(-1)).toBe(`/v/${CLOSED_MAX + 4}.md`);
  });
});

describe("vault 를 바꿀 때", () => {
  /** ⚠️ 남의 vault 경로를 되살리면 **빈 노트**가 열린다. */
  it("비운다", () => {
    pushClosed("/v1/a.md");
    clearClosed();
    expect(popClosed()).toBeNull();
  });
});
