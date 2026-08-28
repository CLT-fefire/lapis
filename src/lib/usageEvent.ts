/**
 * 사용 로그의 **스키마와 집계** — 순수 절반.
 *
 * ## ⚠️ 스키마는 여기 하나다
 *
 * Rust 쪽(`usage.rs`)은 줄을 **해석하지 않는다.** 문자열을 받아 붙이고, 읽을 때도
 * 문자열 배열을 준다. 스키마를 두 곳에 두면 반드시 갈리고, 갈린 로그는 **분석할 때가
 * 돼서야** 틀린 것이 드러난다 — 그때는 이미 몇 달치가 쌓여 있다.
 *
 * ## ⚠️ 자세히 담되, 나가는 것은 가린다
 *
 * 기록은 최대한 자세히 한다(경로 · 질의 · 오류 본문). **로컬 파일이고 어디로도 안 보낸다.**
 * 사고는 원본이 아니라 **밖으로 나가는 리포트**에서 난다 — 붙여넣기 한 번이면 vault 구조와
 * 검색어가 공개 저장소에 남는다. 그래서 `redact()` 가 리포트 경계에 서 있고, 원본을 그대로
 * 내보내려면 **명시적으로 요구**해야 한다.
 */

/** 명령이 들어온 입구. "무엇을 썼나"보다 "어디로 들어왔나"가 고칠 곳을 정한다. */
export type CommandSurface =
  | "palette"
  | "keymap"
  | "rail"
  | "menu"
  | "button"
  | "titlebar"
  | "cli";

export const COMMAND_SURFACES: readonly CommandSurface[] = [
  "palette",
  "keymap",
  "rail",
  "menu",
  "button",
  "titlebar",
  "cli",
] as const;

/** 이벤트 한 건. `k` 가 판별자다. */
export type UsageEvent =
  | {
      k: "cmd";
      t: number;
      /** `commands.ts` 의 id 또는 keymap action. */
      id: string;
      via: CommandSurface;
    }
  | {
      k: "err";
      t: number;
      /** 어디서 났나 — 모듈 경로(`stores/vault`). 파일을 옮기면 여기도 옮긴다. */
      at: string;
      /** 무엇이 났나 — 원래 `console.error` 의 첫 인자를 그대로 쓴다. */
      msg: string;
      /** 예외 문자열. 없을 수 있다. */
      detail?: string;
      /** 오류가 난 노트 경로. 있으면 담는다 — 로컬이라 자세히 담는 쪽이 낫다. */
      path?: string;
    }
  | {
      k: "session";
      t: number;
      ev: "start";
      /** 앱 버전 — 어느 버전에서 난 오류인지 나중에 갈라 보려면 필요하다. */
      v: string;
      os: string;
    };

export type UsageEventKind = UsageEvent["k"];

/** 한 줄로. ⚠️ 개행이 섞이면 한 줄 = 한 이벤트가 깨진다 — Rust 쪽도 그런 줄을 버린다. */
export function serialize(e: UsageEvent): string {
  return JSON.stringify(e).replace(/[\n\r]/g, " ");
}

/**
 * 한 줄 → 이벤트. 못 읽으면 `null`.
 *
 * ⚠️ **던지지 않는다.** 한 줄이 깨졌다고 그 달 전체를 못 보면, 로그를 남긴 뜻이 사라진다.
 * 줄 단위 형식을 고른 이유가 이것이다.
 */
export function parseLine(line: string): UsageEvent | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.t !== "number") return null;
  if (o.k === "cmd") {
    if (typeof o.id !== "string" || typeof o.via !== "string") return null;
    if (!(COMMAND_SURFACES as readonly string[]).includes(o.via)) return null;
    return { k: "cmd", t: o.t, id: o.id, via: o.via as CommandSurface };
  }
  if (o.k === "err") {
    if (typeof o.at !== "string" || typeof o.msg !== "string") return null;
    return {
      k: "err",
      t: o.t,
      at: o.at,
      msg: o.msg,
      ...(typeof o.detail === "string" ? { detail: o.detail } : {}),
      ...(typeof o.path === "string" ? { path: o.path } : {}),
    };
  }
  if (o.k === "session") {
    if (o.ev !== "start" || typeof o.v !== "string" || typeof o.os !== "string") return null;
    return { k: "session", t: o.t, ev: "start", v: o.v, os: o.os };
  }
  return null;
}

/** `YYYY-MM` — 파일 이름이 되는 값. Rust 쪽이 이 형식만 받는다. */
export function monthOf(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─── 집계 ────────────────────────────────────────────────────────────────────

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
}

export interface UsageSummary {
  events: number;
  /** 못 읽은 줄 수. ⚠️ 0이 아니면 화면이 말해야 한다 — 조용히 빼면 통계가 거짓말이 된다. */
  unreadable: number;
  from: number | null;
  to: number | null;
  sessions: number;
  commands: CommandStat[];
  errors: ErrorStat[];
  /** 한 번도 안 쓰인 명령. 이 목록이 "지워도 되나"를 말해 준다. */
  unusedCommands: string[];
}

/**
 * 줄 배열 → 요약.
 *
 * @param knownCommands 앱이 아는 명령 전체. 안 쓰인 것을 세려면 **분모**가 필요하다 —
 *   로그만 보면 "안 쓴 명령"은 애초에 안 보인다.
 */
export function summarize(lines: readonly string[], knownCommands: readonly string[] = []): UsageSummary {
  const cmd = new Map<string, CommandStat>();
  const err = new Map<string, ErrorStat>();
  let events = 0;
  let unreadable = 0;
  let sessions = 0;
  let from: number | null = null;
  let to: number | null = null;

  for (const line of lines) {
    const e = parseLine(line);
    if (!e) {
      unreadable++;
      continue;
    }
    events++;
    from = from === null ? e.t : Math.min(from, e.t);
    to = to === null ? e.t : Math.max(to, e.t);

    if (e.k === "cmd") {
      const s = cmd.get(e.id) ?? { id: e.id, total: 0, via: {} };
      s.total++;
      s.via[e.via] = (s.via[e.via] ?? 0) + 1;
      cmd.set(e.id, s);
    } else if (e.k === "err") {
      const key = `${e.at}::${e.msg}`;
      const s = err.get(key) ?? { at: e.at, msg: e.msg, count: 0, lastAt: e.t };
      s.count++;
      s.lastAt = Math.max(s.lastAt, e.t);
      err.set(key, s);
    } else {
      sessions++;
    }
  }

  const commands = [...cmd.values()].sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
  const errors = [...err.values()].sort(
    (a, b) => b.count - a.count || b.lastAt - a.lastAt || a.at.localeCompare(b.at),
  );
  const used = new Set(commands.map((c) => c.id));
  const unusedCommands = knownCommands.filter((c) => !used.has(c)).sort();

  return { events, unreadable, from, to, sessions, commands, errors, unusedCommands };
}

// ─── 리포트 경계 ─────────────────────────────────────────────────────────────

/**
 * 밖으로 나갈 때 **가린다**.
 *
 * ⚠️ 이 함수가 서 있는 자리가 요점이다. 로그 원본은 자세하고, 자세한 것이 맞다 —
 * 로컬이고 나중에 기능 개선에 쓴다. 위험한 것은 **리포트를 어디에 붙여넣는 순간**이다.
 * 이 저장소는 공개이고, vault 경로와 검색어는 생각의 내용 그 자체다.
 *
 * 가린 뒤에도 통계는 그대로 쓸 수 있다 — 개수·빈도·입구는 경로를 몰라도 된다.
 */
export function redact(text: string): string {
  return (
    text
      // Windows·POSIX 절대 경로 → 마지막 조각만
      .replace(/(?:[A-Za-z]:)?[\\/][\w.\-가-힣 ]+(?:[\\/][\w.\-가-힣 ]+)+/g, (m) => {
        const last = m.split(/[\\/]/).filter(Boolean).pop() ?? "";
        return `…/${last}`;
      })
      // 사용자 이름이 들어가는 흔한 자리
      .replace(/[\\/]Users[\\/][^\\/\s]+/gi, "/Users/…")
      .replace(/[\\/]home[\\/][^\\/\s]+/gi, "/home/…")
  );
}

/** 리포트 한 줄에 쓸 안전한 요약. `raw` 면 가리지 않는다 — **부르는 쪽이 명시**해야 한다. */
export function errorLine(e: ErrorStat, raw = false): string {
  const s = `${e.at} — ${e.msg}`;
  return raw ? s : redact(s);
}
