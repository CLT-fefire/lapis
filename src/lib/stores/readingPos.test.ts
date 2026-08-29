import { describe, it, expect, beforeEach } from "vitest";
import {
  rememberPos,
  posFor,
  clearPositions,
  pruneTo,
  serializePositions,
  parsePositions,
  POSITIONS_MAX,
  type ReadingPos,
} from "./readingPos";

/**
 * 읽던 자리.
 *
 * ## ⚠️ 조용히 틀리는 방법이 둘이다
 *
 * 1. **남의 자리로 복원한다** — 노트를 바꾸는 순간 이전 노트의 위치가 새 본문에 적용되면,
 *    엉뚱한 데로 튀고 사용자는 자기가 스크롤한 줄 안다. 그래서 자리는 **경로로만** 찾는다.
 * 2. **끝없이 자란다** — 열어 본 노트마다 한 줄씩 쌓이면 `localStorage` 가 계속 커진다.
 *    19,000 노트 vault 에서는 그게 실제 문제다.
 */

beforeEach(() => {
  clearPositions();
});

describe("기억하고 꺼내기", () => {
  it("경로별로 따로 든다", () => {
    rememberPos("/v/a.md", { scroll: 100 });
    rememberPos("/v/b.md", { scroll: 250 });
    expect(posFor("/v/a.md")).toEqual({ scroll: 100 });
    expect(posFor("/v/b.md")).toEqual({ scroll: 250 });
  });

  it("모르는 경로는 null", () => {
    expect(posFor("/v/없다.md")).toBeNull();
  });

  it("다시 적으면 덮어쓴다", () => {
    rememberPos("/v/a.md", { scroll: 10 });
    rememberPos("/v/a.md", { scroll: 20 });
    expect(posFor("/v/a.md")).toEqual({ scroll: 20 });
  });

  /** 편집기는 픽셀이 아니라 **줄**로 기억한다 — CodeMirror 의 `scrollTop` 은 못 믿는다. */
  it("편집기 줄도 든다", () => {
    rememberPos("/v/a.md", { scroll: 0, line: 42 });
    expect(posFor("/v/a.md")).toEqual({ scroll: 0, line: 42 });
  });

  /**
   * ⚠️ **맨 위는 기억하지 않는다.** 0 을 저장하면 "아직 안 읽음"과 "맨 위까지 올려 뒀음"이
   * 구별이 안 되고, 항목만 쌓인다.
   */
  it("맨 위면 자리를 안 만든다", () => {
    rememberPos("/v/a.md", { scroll: 0 });
    expect(posFor("/v/a.md")).toBeNull();
  });

  it("맨 위로 올리면 있던 자리를 지운다", () => {
    rememberPos("/v/a.md", { scroll: 300 });
    rememberPos("/v/a.md", { scroll: 0 });
    expect(posFor("/v/a.md")).toBeNull();
  });

  /** 줄이 있으면 스크롤이 0 이어도 뜻이 있다 — 편집기가 맨 위가 아닐 수 있다. */
  it("줄이 있으면 스크롤 0 이어도 든다", () => {
    rememberPos("/v/a.md", { scroll: 0, line: 5 });
    expect(posFor("/v/a.md")).toEqual({ scroll: 0, line: 5 });
  });
});

describe("끝없이 안 자란다", () => {
  it("상한을 넘으면 오래된 것부터 나간다", () => {
    for (let i = 0; i < POSITIONS_MAX + 10; i++) {
      rememberPos(`/v/${i}.md`, { scroll: i + 1 });
    }
    expect(posFor("/v/0.md"), "가장 오래된 것이 남아 있다").toBeNull();
    expect(posFor(`/v/${POSITIONS_MAX + 9}.md`)).not.toBeNull();
  });

  /** ⚠️ 다시 적은 것은 **최근**이다 — 안 그러면 자주 보는 노트가 먼저 밀려난다. */
  it("다시 적으면 최근으로 올라온다", () => {
    for (let i = 0; i < POSITIONS_MAX; i++) rememberPos(`/v/${i}.md`, { scroll: i + 1 });
    rememberPos("/v/0.md", { scroll: 999 });
    rememberPos("/v/새것.md", { scroll: 1 });
    expect(posFor("/v/0.md"), "다시 본 노트가 밀려났다").toEqual({ scroll: 999 });
    expect(posFor("/v/1.md"), "그다음으로 오래된 것이 안 밀려났다").toBeNull();
  });

  /** 탭에 없는 자리를 정리할 수 있어야 한다 — vault 를 바꿀 때 쓴다. */
  it("주어진 경로만 남긴다", () => {
    rememberPos("/v/a.md", { scroll: 1 });
    rememberPos("/v/b.md", { scroll: 2 });
    pruneTo(["/v/a.md"]);
    expect(posFor("/v/a.md")).not.toBeNull();
    expect(posFor("/v/b.md")).toBeNull();
  });
});

describe("저장 형태", () => {
  it("왕복", () => {
    rememberPos("/v/a.md", { scroll: 100, line: 3 });
    rememberPos("/v/b.md", { scroll: 5 });
    const round = parsePositions(serializePositions());
    expect(round.get("/v/a.md")).toEqual({ scroll: 100, line: 3 });
    expect(round.get("/v/b.md")).toEqual({ scroll: 5 });
  });

  /** ⚠️ 깨진 값에 죽으면 **앱이 안 뜬다.** 자리 기억 하나 때문에 그럴 이유가 없다. */
  it("깨진 값이면 빈 것으로 본다", () => {
    expect(parsePositions("이건 JSON 이 아니다").size).toBe(0);
    expect(parsePositions("null").size).toBe(0);
    expect(parsePositions("[]").size).toBe(0);
    expect(parsePositions('{"/v/a.md":"숫자가 아니다"}').size).toBe(0);
  });

  it("모양이 틀린 항목만 버린다", () => {
    const m = parsePositions('{"/v/a.md":{"scroll":10},"/v/b.md":{"scroll":"x"}}');
    expect(m.get("/v/a.md")).toEqual({ scroll: 10 });
    expect(m.has("/v/b.md")).toBe(false);
  });

  it("음수 스크롤은 버린다", () => {
    expect(parsePositions('{"/v/a.md":{"scroll":-5}}').size).toBe(0);
  });
});

describe("타입", () => {
  it("ReadingPos 는 scroll 이 필수다", () => {
    const p: ReadingPos = { scroll: 0 };
    expect(p.scroll).toBe(0);
  });
});
