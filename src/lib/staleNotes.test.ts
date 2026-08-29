import { describe, it, expect } from "vitest";
import { findStaleNotes, STALE_DAYS } from "./staleNotes";

/**
 * 오래 안 건드린 노트.
 *
 * ## 🔴 "모른다"를 "오래됐다"로 세면 안 된다
 *
 * 인덱스가 덜 찬 순간에는 `mtime` 이 없는 노트가 많다. 그걸 "아주 오래됨"으로 세면
 * **vault 전체가 목록에 뜨고**, 그 뒤로는 아무도 이 목록을 안 믿는다.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-29T00:00:00Z");
const ago = (d: number) => NOW - d * DAY;

describe("고른다", () => {
  it("문턱보다 오래된 것만", () => {
    const r = findStaleNotes(
      [
        { path: "/v/오래.md", mtimeMs: ago(400), dateMs: null },
        { path: "/v/최근.md", mtimeMs: ago(3), dateMs: null },
      ],
      NOW,
    );
    expect(r.map((x) => x.path)).toEqual(["/v/오래.md"]);
  });

  it("오래된 것부터", () => {
    const r = findStaleNotes(
      [
        { path: "/v/b.md", mtimeMs: ago(200), dateMs: null },
        { path: "/v/a.md", mtimeMs: ago(900), dateMs: null },
      ],
      NOW,
    );
    expect(r.map((x) => x.path)).toEqual(["/v/a.md", "/v/b.md"]);
  });

  it("며칠 됐는지 센다", () => {
    const [r] = findStaleNotes([{ path: "/v/a.md", mtimeMs: ago(365), dateMs: null }], NOW);
    expect(r.days).toBe(365);
  });

  it("문턱을 바꿀 수 있다", () => {
    const notes = [{ path: "/v/a.md", mtimeMs: ago(10), dateMs: null }];
    expect(findStaleNotes(notes, NOW)).toHaveLength(0);
    expect(findStaleNotes(notes, NOW, 7)).toHaveLength(1);
  });

  /** 기본 문턱은 반기 — 그보다 짧으면 목록이 늘 차 있어서 안 본다. */
  it("기본 문턱이 반기다", () => {
    expect(STALE_DAYS).toBe(180);
  });
});

describe("무엇을 '손댔다'로 보나", () => {
  /**
   * ⚠️ `mtime` 과 frontmatter `date` 중 **더 최근**을 쓴다. `mtime` 은 git 이동에도
   * 바뀌고, `date` 는 손으로 적는 값이라 안 고치면 안 바뀐다 — 어느 쪽이든 흔적이다.
   */
  it("둘 중 더 최근을 쓴다", () => {
    const r = findStaleNotes(
      [{ path: "/v/a.md", mtimeMs: ago(900), dateMs: ago(3) }],
      NOW,
    );
    expect(r, "date 가 최근인데 오래된 것으로 셌다").toHaveLength(0);
  });

  it("date 만 있어도 센다", () => {
    const r = findStaleNotes([{ path: "/v/a.md", mtimeMs: null, dateMs: ago(400) }], NOW);
    expect(r).toHaveLength(1);
  });

  /** 🔴 둘 다 모르면 **뺀다.** 모르는 것을 오래됐다고 하면 목록을 못 믿는다. */
  it("둘 다 모르면 뺀다", () => {
    const r = findStaleNotes([{ path: "/v/a.md", mtimeMs: null, dateMs: null }], NOW);
    expect(r).toEqual([]);
  });

  /** ⚠️ 시계가 어긋난 파일이 "0일 전"으로 목록 맨 위에 서면 안 된다. */
  it("미래 시각은 뺀다", () => {
    const r = findStaleNotes([{ path: "/v/a.md", mtimeMs: NOW + DAY, dateMs: null }], NOW);
    expect(r).toEqual([]);
  });
});

describe("빈 입력", () => {
  it("빈 목록", () => {
    expect(findStaleNotes([], NOW)).toEqual([]);
  });
});
