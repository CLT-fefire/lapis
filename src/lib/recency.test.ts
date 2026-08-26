import { describe, it, expect } from "vitest";
import {
  parseSince,
  parseFrontmatterDate,
  partitionSince,
  sortRecent,
  sortPath,
  SinceError,
} from "./recency";

/** 2026-08-26 12:00:00 UTC — 테스트가 시스템 시계를 읽지 않는다. */
const NOW = Date.UTC(2026, 7, 26, 12, 0, 0);
const DAY = 86_400_000;

describe("--since 파싱", () => {
  it("일·시간·주를 받는다", () => {
    expect(parseSince("7d", NOW)).toBe(NOW - 7 * DAY);
    expect(parseSince("24h", NOW)).toBe(NOW - DAY);
    expect(parseSince("2w", NOW)).toBe(NOW - 14 * DAY);
  });

  it("0도 받는다 — '지금 이후'는 빈 결과지만 오류는 아니다", () => {
    expect(parseSince("0d", NOW)).toBe(NOW);
  });

  it("절대 날짜를 받는다 — UTC 자정 기준", () => {
    expect(parseSince("2026-08-01", NOW)).toBe(Date.UTC(2026, 7, 1));
  });

  /**
   * ⚠️ 로컬 자정으로 해석하면 같은 인자가 머신의 시간대에 따라 다른 결과를 낸다.
   * 이 도구의 전제가 "같은 인자면 같은 결과"다.
   */
  it("날짜 해석이 시간대에 의존하지 않는다", () => {
    expect(parseSince("2026-01-01", NOW)).toBe(1767225600000);
  });

  it("대문자 단위도 받는다", () => {
    expect(parseSince("7D", NOW)).toBe(parseSince("7d", NOW));
  });

  /** 조용히 0으로 떨어지면 "왜 전부 나오지"가 된다. */
  it("모르는 형식은 던진다", () => {
    for (const bad of ["", "d", "7", "7x", "abc", "2026-13-01", "-3d", "7 d"]) {
      expect(() => parseSince(bad, NOW), `입력=${bad}`).toThrow(SinceError);
    }
  });

  it("오류가 받아들이는 형식을 말해준다", () => {
    try {
      parseSince("어제", NOW);
      expect.unreachable();
    } catch (e) {
      expect((e as SinceError).message).toMatch(/7d|24h|YYYY-MM-DD/);
    }
  });
});

describe("프론트매터 date 파싱", () => {
  it("날짜만 있는 값을 UTC 자정으로", () => {
    expect(parseFrontmatterDate("2026-08-26")).toBe(Date.UTC(2026, 7, 26));
  });

  it("시각이 붙어도 받는다", () => {
    expect(parseFrontmatterDate("2026-08-26T09:30:00Z")).toBe(
      Date.UTC(2026, 7, 26, 9, 30, 0),
    );
  });

  /** ⚠️ 프론트매터 값은 사람이 손으로 적는다. 아무 문자열이 올 수 있다. */
  it("날짜가 아니면 null", () => {
    for (const bad of ["", "미정", "TBD", "2026", "26/08/2026", "2026-99-99"]) {
      expect(parseFrontmatterDate(bad), `입력=${bad}`).toBeNull();
    }
  });
});

interface Row {
  path: string;
}
const rows = (...paths: string[]): Row[] => paths.map((path) => ({ path }));

describe("기간 필터", () => {
  const times: Record<string, number> = {
    "a.md": NOW - 1 * DAY,
    "b.md": NOW - 10 * DAY,
    "c.md": NOW - 3 * DAY,
  };
  const timeOf = (p: string) => times[p] ?? null;

  it("기준보다 새로운 것만 남긴다", () => {
    const r = partitionSince(rows("a.md", "b.md", "c.md"), NOW - 7 * DAY, timeOf);
    expect(r.kept.map((x) => x.path)).toEqual(["a.md", "c.md"]);
    expect(r.droppedOlder).toBe(1);
  });

  /**
   * ⚠️ 시간 값이 없는 노트는 "언제 이후"를 만족한다고 말할 수 없다. 빼되 **몇 개를
   * 뺐는지 알린다** — 조용히 줄이면 "왜 안 나오지"의 원인이 인자였다는 걸 알 방법이 없다.
   */
  it("시간 값이 없는 노트는 빼고 세어서 알린다", () => {
    const r = partitionSince(rows("a.md", "unknown.md"), NOW - 7 * DAY, timeOf);
    expect(r.kept.map((x) => x.path)).toEqual(["a.md"]);
    expect(r.droppedNoTime).toBe(1);
    expect(r.droppedOlder).toBe(0);
  });

  it("경계는 포함한다", () => {
    const at = (p: string) => (p === "edge.md" ? NOW - 7 * DAY : null);
    expect(partitionSince(rows("edge.md"), NOW - 7 * DAY, at).kept).toHaveLength(1);
  });
});

describe("최근 순 정렬", () => {
  it("새로운 것이 먼저", () => {
    const t: Record<string, number> = { "old.md": NOW - 10 * DAY, "new.md": NOW - 1 * DAY };
    const out = sortRecent(rows("old.md", "new.md"), (p) => t[p] ?? null);
    expect(out.map((x) => x.path)).toEqual(["new.md", "old.md"]);
  });

  /**
   * ⚠️ **동률이 예외가 아니라 기본이다.** 실측: 47노트 중 43개가 같은 프론트매터 date를
   * 갖는다. 타이브레이크가 없으면 답이 입력 순서에 흔들린다.
   */
  it("동률이면 경로 오름차순 — 입력 순서와 무관하다", () => {
    const same = () => NOW;
    const fwd = sortRecent(rows("z.md", "a.md", "m.md"), same).map((x) => x.path);
    const rev = sortRecent(rows("m.md", "a.md", "z.md"), same).map((x) => x.path);
    expect(fwd).toEqual(["a.md", "m.md", "z.md"]);
    expect(rev).toEqual(fwd);
  });

  /** 시간 값이 없는 노트는 맨 뒤로. 그 안에서도 경로순. */
  it("시간 값이 없으면 맨 뒤", () => {
    const t: Record<string, number> = { "has.md": NOW };
    const out = sortRecent(rows("z-none.md", "has.md", "a-none.md"), (p) => t[p] ?? null);
    expect(out.map((x) => x.path)).toEqual(["has.md", "a-none.md", "z-none.md"]);
  });

  it("원본 배열을 바꾸지 않는다", () => {
    const input = rows("b.md", "a.md");
    sortPath(input);
    expect(input.map((x) => x.path)).toEqual(["b.md", "a.md"]);
  });
});

describe("경로 순 정렬", () => {
  it("UTF-16 코드 단위 — 로케일에 의존하지 않는다", () => {
    expect(sortPath(rows("나.md", "가.md", "다.md")).map((x) => x.path)).toEqual([
      "가.md",
      "나.md",
      "다.md",
    ]);
  });
});
