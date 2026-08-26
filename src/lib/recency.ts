/**
 * 시간축 — `--since` 파싱 · 기간 필터 · 최근 순 정렬. **순수 함수만 있다.**
 *
 * ## 축이 둘이다
 *
 * | 축 | 답하는 질문 | 약점 |
 * |---|---|---|
 * | `mtime` | 내가 실제로 만진 것 | ⚠️ **git이 덮어쓴다** |
 * | `date` (프론트매터) | 문서가 주장하는 시점 | 안 적은 노트는 빠지고, 고치고 안 올리면 누락 |
 *
 * ⚠️ **`git pull`·`checkout`은 바뀐 파일의 mtime을 체크아웃 시각으로 쓴다.** 새로 클론하면
 * 모든 파일이 같은 mtime이다. 그래서 pull 직후 "최근 바뀐 것"은 "pull이 건드린 것"이 된다.
 * 두 머신을 git으로 동기화하면 바로 걸린다 — 그게 축을 둘 두는 이유다.
 *
 * 이 모듈은 어느 축인지 모른다. 호출부가 `timeOf`를 넘긴다.
 *
 * ## ⚠️ "지금"을 인자로 받는다
 *
 * 시스템 시계를 읽으면 테스트가 간헐 실패한다. 그리고 같은 인자가 같은 결과를 내야
 * 한다는 이 도구의 전제와도 어긋난다.
 */

/** 잘못된 `--since` 값. 호출부가 사용법 오류로 보고할 수 있게 구분한다. */
export class SinceError extends Error {
  constructor(input: string) {
    super(
      `--since 값을 읽을 수 없다: "${input}" — 기간(7d · 24h · 2w) 또는 날짜(YYYY-MM-DD)`,
    );
    this.name = "SinceError";
  }
}

const UNIT_MS: Record<string, number> = {
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * `--since` → **하한 타임스탬프**(이 값 이상이면 통과).
 *
 * `7d` · `24h` · `2w` · `2026-08-01`.
 *
 * ⚠️ 날짜는 **UTC 자정**으로 해석한다. 로컬 자정으로 하면 같은 인자가 머신의 시간대에
 * 따라 다른 결과를 낸다.
 *
 * ⚠️ 못 읽으면 **던진다.** 조용히 0으로 떨어뜨리면 "왜 전부 나오지"가 되고, 원인이
 * 인자였다는 걸 알 방법이 없다.
 */
export function parseSince(input: string, nowMs: number): number {
  const s = input.trim();

  const rel = /^(\d+)([hdwHDW])$/.exec(s);
  if (rel) {
    return nowMs - Number(rel[1]) * UNIT_MS[rel[2].toLowerCase()];
  }

  const abs = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (abs) {
    const [y, m, d] = [Number(abs[1]), Number(abs[2]), Number(abs[3])];
    const ms = Date.UTC(y, m - 1, d);
    // ⚠️ `Date.UTC`는 2026-13-01을 2027-01-01로 **말없이 넘긴다.** 되돌려 확인한다.
    const back = new Date(ms);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
      throw new SinceError(input);
    }
    return ms;
  }

  throw new SinceError(input);
}

/**
 * 프론트매터 `date` 값 → 타임스탬프. 날짜로 안 읽히면 `null`.
 *
 * ⚠️ 이 값은 **사람이 손으로 적는다.** `미정` · `TBD` · `2026` 같은 것이 온다. 던지지 않고
 * `null`을 내는 이유 — 한 노트의 오타가 질의 전체를 세우면 안 된다. 그런 노트는 이 축에서
 * 정렬 불가로 다뤄진다(맨 뒤 또는 제외).
 */
export function parseFrontmatterDate(raw: string): number | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    try {
      return parseSince(s, 0);
    } catch {
      return null;
    }
  }
  // 시각이 붙은 형태만 추가로 받는다. 임의 문자열을 `Date`에 먹이면 구현마다 다르게 읽는다.
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) {
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** 노트 경로 → 그 축의 타임스탬프. 값이 없으면 `null`. */
export type TimeOf = (path: string) => number | null;

export interface Partitioned<T> {
  kept: T[];
  /** 기준보다 오래돼서 빠진 수. */
  droppedOlder: number;
  /** 이 축에 시간 값이 **없어서** 빠진 수. */
  droppedNoTime: number;
}

/**
 * 기준 이후만 남긴다. 경계는 포함한다.
 *
 * ⚠️ 시간 값이 없는 노트는 **빼되 몇 개인지 알린다.** "언제 이후"를 만족한다고 말할 수
 * 없기 때문에 빼는 것이고, 조용히 빼면 `--by date`로 물었을 때 날짜를 안 적은 노트가
 * 사라진 이유를 아무도 모른다.
 */
export function partitionSince<T extends { path: string }>(
  rows: readonly T[],
  cutoffMs: number,
  timeOf: TimeOf,
): Partitioned<T> {
  const kept: T[] = [];
  let droppedOlder = 0;
  let droppedNoTime = 0;
  for (const row of rows) {
    const t = timeOf(row.path);
    if (t === null) droppedNoTime++;
    else if (t < cutoffMs) droppedOlder++;
    else kept.push(row);
  }
  return { kept, droppedOlder, droppedNoTime };
}

/** 결정적 문자열 비교 — **UTF-16 코드 단위**. 로케일에 따라 갈리지 않게. */
const asc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 최근 순. 시간 값이 없는 노트는 **맨 뒤**로.
 *
 * ⚠️ 동률 타이브레이크는 **경로 오름차순**이고, 이건 엣지 케이스가 아니라 **주 경로**다 —
 * 실측에서 47노트 중 43개가 같은 프론트매터 `date`를 가졌다. 타이브레이크가 없으면 답이
 * 입력 순서에 흔들린다.
 */
export function sortRecent<T extends { path: string }>(rows: readonly T[], timeOf: TimeOf): T[] {
  return [...rows].sort((a, b) => {
    const ta = timeOf(a.path);
    const tb = timeOf(b.path);
    if (ta === null && tb === null) return asc(a.path, b.path);
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta || asc(a.path, b.path);
  });
}

/** 경로 오름차순. 원본을 바꾸지 않는다. */
export function sortPath<T extends { path: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => asc(a.path, b.path));
}
