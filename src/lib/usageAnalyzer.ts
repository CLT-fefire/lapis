import {
  parseLine,
  type OpenSurface,
  type PerfOp,
  type QueryKind,
  type UsageEvent,
} from "$lib/usageSchema";

/**
 * 사용 로그의 **집계** — 종류마다 하나씩.
 *
 * ## ⚠️ 왜 클래스인가
 *
 * 이 저장소는 순수 함수와 store 로 돼 있고 클래스가 거의 없다. 여기는 예외로 둘 이유가
 * 있다: **달을 하나씩 흘려보내야 하기 때문이다.**
 *
 * 예전엔 호출부가 모든 달을 한 배열로 모아 넘겼다. 월 파일 상한이 16 MB 이므로 열두
 * 달이면 최악 192 MB 의 문자열 배열이고, 담는 종류가 늘수록 빨리 커진다. `feed(line)` 이
 * 상태를 누적하면 호출부가 **달마다 읽어 먹이고 버릴 수 있다.**
 *
 * 순수 함수로 같은 일을 하려면 누적기를 호출부가 들고 다녀야 하는데, 그건 클래스를 손으로
 * 만드는 것이다.
 *
 * ## ⚠️ 종류를 더할 때
 *
 * `UsageEvent` 에 종류를 더하고 여기 `take()` 에 갈래를 하나 더한다. **집계 결과를 지우지
 * 않는다** — 리포트가 옛 필드를 읽고 있을 수 있고, 그건 에러 없이 빈 절이 된다.
 */

export interface CommandStat {
  id: string;
  total: number;
  /** 입구별 횟수. **이게 이 통계의 요점이다** — "400번 중 380번이 ⌘P". */
  via: Record<string, number>;
}

export interface ErrorStat {
  at: string;
  msg: string;
  count: number;
  /** 마지막으로 난 시각. 옛날에 한 번 난 것과 방금 난 것은 다른 문제다. */
  lastAt: number;
  /** 없으면 오류. */
  lvl?: "warn";
}

export interface EmptyQueryStat {
  q: string;
  kind: QueryKind;
  count: number;
}

export interface QuerySummary {
  byKind: Record<string, number>;
  /** 🔴 결과가 0건이었던 질의. **반복되는 것이 곧 개선 지점이다.** */
  empty: EmptyQueryStat[];
  /**
   * 결과가 있었는데 **아무것도 안 연** 비율. 질의가 없으면 `null`.
   *
   * ⚠️ `hit` 가 안 실린 옛 줄은 분모에서 뺀다 — 없는 것을 "안 열었다"로 세면 비율이
   * 조용히 부풀어 오른다.
   */
  missRate: number | null;
}

export interface OpenStat {
  path: string;
  total: number;
  via: Record<string, number>;
}

export interface PerfStat {
  op: PerfOp;
  count: number;
  avgMs: number;
  /** ⚠️ 평균만 보면 드문 느림이 묻힌다. */
  maxMs: number;
}

export interface UsageSummary {
  /** 읽어낸 이벤트 수. */
  events: number;
  /** 깨진 줄 — JSON 이 아니거나 모양이 틀렸다. */
  malformed: number;
  /** 🔴 **모르는 종류 — 손상이 아니다.** 더 새 버전이 쓴 줄이라는 뜻이다. */
  unknownKind: number;
  /** 못 읽은 줄 합계. ⚠️ 0이 아니면 화면이 말해야 한다 — 조용히 빼면 통계가 거짓말이 된다. */
  unreadable: number;
  from: number | null;
  to: number | null;
  sessions: number;
  /** 끝난 세션의 평균 길이(ms). 끝 이벤트가 없으면 `null`. */
  avgSessionMs: number | null;
  commands: CommandStat[];
  errors: ErrorStat[];
  errorCount: number;
  warnCount: number;
  queries: QuerySummary;
  opens: OpenStat[];
  /** 노트에 닿은 입구 분포 — "무엇으로 이동하나". */
  openVia: Record<string, number>;
  perf: PerfStat[];
  /**
   * 한 번도 안 쓰인 명령. 이 목록이 "지워도 되나"를 말해 준다.
   *
   * 🔴 **분모를 모르면 `null` 이다.** 빈 배열은 "다 썼다"로 읽힌다 — 실제로 그렇게
   * 읽혔다. 명령이 0건 쓰인 로그를 두고 `lapis_usage` 가 "안 쓴 명령 없음"을 냈다.
   * 부른 쪽은 알 방법이 없었다. 모르면 모른다고 말한다.
   */
  unusedCommands: string[] | null;
}

export interface AnalyzerOptions {
  /**
   * 앱이 아는 명령 전체. 안 쓰인 것을 세려면 **분모**가 필요하다 — 로그만 보면
   * "안 쓴 명령"은 애초에 안 보인다.
   */
  knownCommands?: readonly string[];
  /** 목록에 담을 최대 항목 수(명령·오류·열람·빈 질의). */
  top?: number;
}

const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1;
};

export class UsageAnalyzer {
  /** ⚠️ `null` 은 **안 받았다**는 뜻이다. 빈 배열(`[]`)과 다르다. */
  readonly #known: readonly string[] | null;
  readonly #top: number;

  #events = 0;
  #malformed = 0;
  #unknownKind = 0;
  #from: number | null = null;
  #to: number | null = null;
  #sessions = 0;
  #sessionMs: number[] = [];

  readonly #cmd = new Map<string, CommandStat>();
  readonly #err = new Map<string, ErrorStat>();
  #errorCount = 0;
  #warnCount = 0;

  readonly #queryByKind: Record<string, number> = {};
  readonly #emptyQuery = new Map<string, EmptyQueryStat>();
  #queryWithHit = 0;
  #queryMissed = 0;

  readonly #open = new Map<string, OpenStat>();
  readonly #openVia: Record<string, number> = {};

  readonly #perf = new Map<PerfOp, { count: number; sum: number; max: number }>();

  constructor(opts: AnalyzerOptions = {}) {
    this.#known = opts.knownCommands ?? null;
    this.#top = opts.top ?? Number.POSITIVE_INFINITY;
  }

  /** 한 줄 먹인다. ⚠️ **던지지 않는다** — 한 줄이 깨져도 나머지는 세야 한다. */
  feed(line: string): void {
    const r = parseLine(line);
    if (!r.ok) {
      if (r.reason === "unknown-kind") this.#unknownKind++;
      else this.#malformed++;
      return;
    }
    this.#events++;
    const e = r.event;
    this.#from = this.#from === null ? e.t : Math.min(this.#from, e.t);
    this.#to = this.#to === null ? e.t : Math.max(this.#to, e.t);
    this.#take(e);
    // 🔴 **세션 길이는 여기서 자란다.** 끝 이벤트를 안 쓰기 때문이다 — 닫을 때 무언가를
    //    하려면 창을 붙잡아야 하고, 그러다 실제로 **X 버튼이 안 먹는 앱**을 만들었다.
    //    마지막 이벤트까지의 시간은 "실제로 쓴 시간"이라 오히려 더 정직하다.
    if (this.#spanStart !== null) this.#spanLast = Math.max(this.#spanLast ?? e.t, e.t);
  }

  #spanStart: number | null = null;
  #spanLast: number | null = null;

  /** 열려 있던 구간을 닫아 길이에 넣는다. 이벤트가 하나뿐이면 길이가 0 이라 안 넣는다. */
  #closeSpan(): void {
    if (this.#spanStart === null || this.#spanLast === null) return;
    const ms = this.#spanLast - this.#spanStart;
    if (ms > 0) this.#sessionMs.push(ms);
    this.#spanStart = null;
    this.#spanLast = null;
  }

  feedAll(lines: Iterable<string>): void {
    for (const l of lines) this.feed(l);
  }

  #take(e: UsageEvent): void {
    switch (e.k) {
      case "cmd": {
        const s = this.#cmd.get(e.id) ?? { id: e.id, total: 0, via: {} };
        s.total++;
        bump(s.via, e.via);
        this.#cmd.set(e.id, s);
        return;
      }
      case "err": {
        // ⚠️ 심각도를 키에 넣는다. 합치면 경고가 오류로 보인다.
        const key = `${e.lvl ?? "err"}::${e.at}::${e.msg}`;
        const s = this.#err.get(key) ?? {
          at: e.at,
          msg: e.msg,
          count: 0,
          lastAt: e.t,
          ...(e.lvl ? { lvl: e.lvl } : {}),
        };
        s.count++;
        s.lastAt = Math.max(s.lastAt, e.t);
        this.#err.set(key, s);
        if (e.lvl === "warn") this.#warnCount++;
        else this.#errorCount++;
        return;
      }
      case "session": {
        if (e.ev === "start") {
          this.#sessions++;
          this.#closeSpan();
          this.#spanStart = e.t;
          this.#spanLast = e.t;
        } else if (typeof e.ms === "number") {
          // v3.7.0 이 쓴 끝 이벤트. 지금은 안 쓰지만 이미 쌓인 줄은 읽는다.
          this.#sessionMs.push(e.ms);
        }
        return;
      }
      case "query": {
        bump(this.#queryByKind, e.kind);
        if (e.n === 0) {
          const key = `${e.kind}::${e.q}`;
          const s = this.#emptyQuery.get(key) ?? { q: e.q, kind: e.kind, count: 0 };
          s.count++;
          this.#emptyQuery.set(key, s);
        } else if (typeof e.hit === "boolean") {
          // ⚠️ `hit` 가 없는 옛 줄은 분모에서 뺀다 — 없는 것을 "안 열었다"로 세면 안 된다.
          this.#queryWithHit++;
          if (!e.hit) this.#queryMissed++;
        }
        return;
      }
      case "open": {
        const s = this.#open.get(e.path) ?? { path: e.path, total: 0, via: {} };
        s.total++;
        bump(s.via, e.via satisfies OpenSurface);
        this.#open.set(e.path, s);
        bump(this.#openVia, e.via);
        return;
      }
      case "perf": {
        const s = this.#perf.get(e.op) ?? { count: 0, sum: 0, max: 0 };
        s.count++;
        s.sum += e.ms;
        s.max = Math.max(s.max, e.ms);
        this.#perf.set(e.op, s);
        return;
      }
    }
  }

  /** ⚠️ **읽기만 한다.** 여러 번 불러도 같은 답이어야 한다 — 화면이 그렇게 쓴다. */
  result(): UsageSummary {
    // ⚠️ **읽기만 하는 함수인데 여기서 구간을 닫는다.** 마지막 세션은 아직 안 끝났으므로
    //    닫지 않으면 통계에서 빠진다. 여러 번 불러도 같은 답이어야 하므로 상태를 안 지우고
    //    사본에만 더한다.
    const spans =
      this.#spanStart !== null && this.#spanLast !== null && this.#spanLast > this.#spanStart
        ? [...this.#sessionMs, this.#spanLast - this.#spanStart]
        : this.#sessionMs;
    const top = this.#top;
    const commands = [...this.#cmd.values()]
      .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id))
      .slice(0, top);
    const errors = [...this.#err.values()]
      .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt || a.at.localeCompare(b.at))
      .slice(0, top);
    const opens = [...this.#open.values()]
      .sort((a, b) => b.total - a.total || a.path.localeCompare(b.path))
      .slice(0, top);
    const empty = [...this.#emptyQuery.values()]
      .sort((a, b) => b.count - a.count || a.q.localeCompare(b.q))
      .slice(0, top);
    const perf = [...this.#perf.entries()]
      .map(([op, s]) => ({ op, count: s.count, avgMs: s.sum / s.count, maxMs: s.max }))
      .sort((a, b) => b.count - a.count || a.op.localeCompare(b.op));

    const used = new Set([...this.#cmd.keys()]);
    const unusedCommands =
      this.#known === null ? null : this.#known.filter((c) => !used.has(c)).sort();

    return {
      events: this.#events,
      malformed: this.#malformed,
      unknownKind: this.#unknownKind,
      unreadable: this.#malformed + this.#unknownKind,
      from: this.#from,
      to: this.#to,
      sessions: this.#sessions,
      avgSessionMs: spans.length === 0 ? null : spans.reduce((a, b) => a + b, 0) / spans.length,
      commands,
      errors,
      errorCount: this.#errorCount,
      warnCount: this.#warnCount,
      queries: {
        byKind: { ...this.#queryByKind },
        empty,
        missRate: this.#queryWithHit === 0 ? null : this.#queryMissed / this.#queryWithHit,
      },
      opens,
      openVia: { ...this.#openVia },
      perf,
      unusedCommands,
    };
  }
}

/**
 * 한 번에 넘기는 옛 경로.
 *
 * ⚠️ 큰 로그에는 쓰지 않는다 — 모든 줄을 한 배열로 들고 있어야 한다. 화면은
 * `UsageAnalyzer` 로 달마다 흘려보낸다.
 */
export function summarize(
  lines: readonly string[],
  knownCommands: readonly string[] = [],
): UsageSummary {
  const a = new UsageAnalyzer({ knownCommands });
  a.feedAll(lines);
  return a.result();
}
