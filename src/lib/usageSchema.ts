/**
 * 사용 로그의 **스키마와 코덱** — 이 파일이 형식의 유일한 출처다.
 *
 * ## ⚠️ 스키마는 여기 하나다
 *
 * Rust 쪽(`usage.rs`)은 줄을 **해석하지 않는다.** 문자열을 받아 붙이고, 읽을 때도 문자열
 * 배열을 준다. 스키마를 두 곳에 두면 반드시 갈리고, 갈린 로그는 **분석할 때가 돼서야**
 * 틀린 것이 드러난다 — 그때는 이미 몇 달치가 쌓여 있다.
 *
 * ## ⚠️ 필드를 지우거나 이름을 바꾸지 않는다
 *
 * 로그는 달마다 쌓이고 지우지 않는다. 이미 쌓인 줄이 조용히 "못 읽은 줄"로 떨어지면
 * 통계가 그만큼 거짓말을 한다. **더하기만 한다.** 옛 형태를 위한 보정이 필요하면
 * `parseLine` 안에 두고 왜 필요한지 적는다.
 *
 * ## ⚠️ 자세히 담는다 — 이 컴퓨터를 안 벗어나므로
 *
 * 기록은 최대한 자세히 한다(경로 · 질의 · 오류 본문). **로컬 파일이고 어디로도 안 보낸다.**
 * 분석 문서도 같은 폴더에만 쓴다 — 내보내는 경로가 없으므로 가릴 경계도 없다.
 * 밖으로 낼 일이 생기면 그때 가리는 것은 **내는 쪽의 일**이지 기록하는 쪽의 일이 아니다.
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

/** 검색의 종류 — 층이 넷이라 섞으면 "무엇이 안 찾히나"를 못 가른다. */
export type QueryKind = "quick" | "fulltext" | "indoc" | "grep";

export const QUERY_KINDS: readonly QueryKind[] = ["quick", "fulltext", "indoc", "grep"] as const;

/** 노트에 닿은 경로. ⚠️ **호출부가 준다** — `selectNote` 안에서 추측하면 틀린다. */
export type OpenSurface =
  | "tree"
  | "palette"
  | "search"
  | "backlink"
  | "wikilink"
  | "tab"
  | "recent"
  | "history"
  /** `lapis open` — 앱 밖에서 들어온다. 다른 입구와 성격이 아주 다르다. */
  | "cli";

export const OPEN_SURFACES: readonly OpenSurface[] = [
  "tree",
  "palette",
  "search",
  "backlink",
  "wikilink",
  "tab",
  "recent",
  "history",
  "cli",
] as const;

/** 잰 것. 시간만으로는 못 읽으므로 규모(`n`)를 같이 담는다. */
export type PerfOp =
  | "index-build"
  | "index-delta"
  | "index-cache-hit"
  | "fulltext-query"
  | "vault-open";

export const PERF_OPS: readonly PerfOp[] = [
  "index-build",
  "index-delta",
  "index-cache-hit",
  "fulltext-query",
  "vault-open",
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
      /**
       * 심각도. 없으면 오류다.
       *
       * ⚠️ 예전엔 `msg` 앞에 `warn: ` 를 붙여 표시했다. 문자열 접두사에 뜻을 담으면
       * 분석할 때마다 다시 파싱해야 한다. `parseLine` 이 옛 줄을 여기로 옮겨 읽는다.
       */
      lvl?: "warn";
    }
  | {
      k: "session";
      t: number;
      ev: "start" | "end";
      /** 앱 버전 — 어느 버전에서 난 오류인지 나중에 갈라 보려면 필요하다. */
      v: string;
      os: string;
      /** 세션 길이(ms). `ev: "end"` 에만 있다. */
      ms?: number;
    }
  | {
      k: "query";
      t: number;
      kind: QueryKind;
      /** ⚠️ **질의문은 생각의 내용 그 자체다.** 분석 문서를 밖으로 낼 때 조심할 것. */
      q: string;
      /** 결과 수. 0 이 반복되는 질의가 곧 개선 지점이다. */
      n: number;
      /** 결과 중 하나를 실제로 열었나. 안 열었으면 못 찾은 것이다. */
      hit?: boolean;
    }
  | {
      k: "open";
      t: number;
      path: string;
      via: OpenSurface;
    }
  | {
      k: "perf";
      t: number;
      op: PerfOp;
      ms: number;
      /** 규모 — 노트 수 등. 시간만 보면 큰 vault 가 느린 건지 코드가 느린 건지 모른다. */
      n?: number;
    };

export type UsageEventKind = UsageEvent["k"];

/** 한 줄로. ⚠️ 개행이 섞이면 한 줄 = 한 이벤트가 깨진다 — Rust 쪽도 그런 줄을 버린다. */
export function serialize(e: UsageEvent): string {
  return JSON.stringify(e).replace(/[\n\r]/g, " ");
}

/**
 * 줄을 못 읽은 이유.
 *
 * ⚠️ **`unknown-kind` 는 손상이 아니다.** 더 새 버전이 쓴 줄이라는 뜻이다. 둘을 합쳐 세면
 * 옛 버전으로 되돌렸을 때 멀쩡한 로그가 "손상된 줄 5000개"로 보인다.
 */
export type ParseResult =
  | { ok: true; event: UsageEvent }
  | { ok: false; reason: "unknown-kind" | "malformed" };

const bad = (reason: "unknown-kind" | "malformed"): ParseResult => ({ ok: false, reason });

const isIn = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

/** 알고 있는 종류 — 이 목록에 없으면 `unknown-kind`, 있는데 모양이 틀리면 `malformed`. */
const KNOWN_KINDS: readonly string[] = ["cmd", "err", "session", "query", "open", "perf"];

/** 옛 `logWarn` 이 심각도를 담던 자리. */
const OLD_WARN_PREFIX = "warn: ";

/**
 * 한 줄 → 이벤트.
 *
 * ⚠️ **던지지 않는다.** 한 줄이 깨졌다고 그 달 전체를 못 보면, 로그를 남긴 뜻이 사라진다.
 * 줄 단위 형식을 고른 이유가 이것이다.
 */
export function parseLine(line: string): ParseResult {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return bad("malformed");
  }
  if (!v || typeof v !== "object") return bad("malformed");
  const o = v as Record<string, unknown>;
  if (typeof o.k !== "string" || !KNOWN_KINDS.includes(o.k)) return bad("unknown-kind");
  if (typeof o.t !== "number") return bad("malformed");

  if (o.k === "cmd") {
    if (typeof o.id !== "string" || !isIn(COMMAND_SURFACES, o.via)) return bad("malformed");
    return { ok: true, event: { k: "cmd", t: o.t, id: o.id, via: o.via } };
  }

  if (o.k === "err") {
    if (typeof o.at !== "string" || typeof o.msg !== "string") return bad("malformed");
    // ⚠️ 옛 줄 보정 — 안 하면 이미 쌓인 경고가 전부 오류로 세어진다.
    let msg = o.msg;
    let lvl: "warn" | undefined = o.lvl === "warn" ? "warn" : undefined;
    if (lvl === undefined && msg.startsWith(OLD_WARN_PREFIX)) {
      lvl = "warn";
      msg = msg.slice(OLD_WARN_PREFIX.length);
    }
    return {
      ok: true,
      event: {
        k: "err",
        t: o.t,
        at: o.at,
        msg,
        ...(typeof o.detail === "string" ? { detail: o.detail } : {}),
        ...(typeof o.path === "string" ? { path: o.path } : {}),
        ...(lvl ? { lvl } : {}),
      },
    };
  }

  if (o.k === "session") {
    if ((o.ev !== "start" && o.ev !== "end") || typeof o.v !== "string" || typeof o.os !== "string") {
      return bad("malformed");
    }
    return {
      ok: true,
      event: {
        k: "session",
        t: o.t,
        ev: o.ev,
        v: o.v,
        os: o.os,
        ...(typeof o.ms === "number" ? { ms: o.ms } : {}),
      },
    };
  }

  if (o.k === "query") {
    if (!isIn(QUERY_KINDS, o.kind) || typeof o.q !== "string" || typeof o.n !== "number") {
      return bad("malformed");
    }
    return {
      ok: true,
      event: {
        k: "query",
        t: o.t,
        kind: o.kind,
        q: o.q,
        n: o.n,
        ...(typeof o.hit === "boolean" ? { hit: o.hit } : {}),
      },
    };
  }

  if (o.k === "open") {
    if (typeof o.path !== "string" || !isIn(OPEN_SURFACES, o.via)) return bad("malformed");
    return { ok: true, event: { k: "open", t: o.t, path: o.path, via: o.via } };
  }

  // perf
  if (!isIn(PERF_OPS, o.op) || typeof o.ms !== "number") return bad("malformed");
  return {
    ok: true,
    event: {
      k: "perf",
      t: o.t,
      op: o.op,
      ms: o.ms,
      ...(typeof o.n === "number" ? { n: o.n } : {}),
    },
  };
}

/** `YYYY-MM` — 파일 이름이 되는 값. Rust 쪽이 이 형식만 받는다. */
export function monthOf(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
