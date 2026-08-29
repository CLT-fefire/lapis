import { describe, it, expect } from "vitest";
import {
  serialize,
  parseLine,
  monthOf,
  redact,
  COMMAND_SURFACES,
  type UsageEvent,
} from "./usageSchema";

/**
 * 사용 로그의 **스키마와 코덱**.
 *
 * ## ⚠️ 이 파일이 지키는 것은 "옛 줄이 계속 읽힌다"
 *
 * 로그는 달마다 쌓이고 지우지 않는다. 스키마를 바꿀 때 **이미 쌓인 줄이 조용히 '못 읽은
 * 줄'로 떨어지면** 통계가 그만큼 거짓말을 한다 — 그리고 그 사실은 몇 달 뒤 분석할 때가
 * 돼서야 드러난다.
 *
 * 그래서 여기서는 **옛 형태를 직접 문자열로 적어** 시험한다. `serialize` 로 만든 줄만
 * 시험하면 코덱이 함께 틀어져도 왕복은 맞으므로 아무것도 못 잡는다.
 */

const roundTrip = (e: UsageEvent) => parseLine(serialize(e));

describe("왕복", () => {
  it("cmd", () => {
    const e: UsageEvent = { k: "cmd", t: 1, id: "quick-open", via: "keymap" };
    expect(roundTrip(e)).toEqual({ ok: true, event: e });
  });

  it("err", () => {
    const e: UsageEvent = { k: "err", t: 2, at: "stores/vault", msg: "실패", detail: "E", path: "/a.md" };
    expect(roundTrip(e)).toEqual({ ok: true, event: e });
  });

  it("query", () => {
    const e: UsageEvent = { k: "query", t: 3, kind: "fulltext", q: "한글 질의", n: 12, hit: true };
    expect(roundTrip(e)).toEqual({ ok: true, event: e });
  });

  it("open", () => {
    const e: UsageEvent = { k: "open", t: 4, path: "/v/a.md", via: "backlink" };
    expect(roundTrip(e)).toEqual({ ok: true, event: e });
  });

  it("perf", () => {
    const e: UsageEvent = { k: "perf", t: 5, op: "index-build", ms: 1234, n: 19000 };
    expect(roundTrip(e)).toEqual({ ok: true, event: e });
  });

  it("session start/end", () => {
    const s: UsageEvent = { k: "session", t: 6, ev: "start", v: "3.6.0", os: "windows" };
    const d: UsageEvent = { k: "session", t: 7, ev: "end", v: "3.6.0", os: "windows", ms: 900_000 };
    expect(roundTrip(s)).toEqual({ ok: true, event: s });
    expect(roundTrip(d)).toEqual({ ok: true, event: d });
  });

  /** ⚠️ 개행이 섞이면 한 줄 = 한 이벤트가 깨진다. */
  it("개행을 지운다", () => {
    const line = serialize({ k: "err", t: 1, at: "a", msg: "첫 줄\n둘째 줄" });
    expect(line).not.toMatch(/[\n\r]/);
  });
});

describe("이미 쌓인 줄", () => {
  /** v3.2.0 이 쓰던 그대로. 필드가 늘어도 이건 계속 읽혀야 한다. */
  it("옛 cmd 줄을 읽는다", () => {
    const r = parseLine('{"k":"cmd","t":1756000000000,"id":"palette","via":"keymap"}');
    expect(r).toEqual({
      ok: true,
      event: { k: "cmd", t: 1756000000000, id: "palette", via: "keymap" },
    });
  });

  it("옛 session 줄에는 ms 가 없다", () => {
    const r = parseLine('{"k":"session","t":1,"ev":"start","v":"3.2.0","os":"windows"}');
    expect(r).toEqual({ ok: true, event: { k: "session", t: 1, ev: "start", v: "3.2.0", os: "windows" } });
  });

  /**
   * 🔴 **옛 경고는 `msg` 접두사에 심각도가 들어 있다.**
   *
   * `logWarn` 이 `k:"err"` 에 `msg:"warn: …"` 로 넣었다. 보정을 안 하면 이미 쌓인 경고가
   * 전부 **오류로 세어지고**, "무엇이 자주 깨지나"의 답이 틀린다.
   */
  it("옛 warn 줄을 경고로 읽고 접두사를 뗀다", () => {
    const r = parseLine('{"k":"err","t":1,"at":"stores/watcher","msg":"warn: 구독 실패"}');
    expect(r).toEqual({
      ok: true,
      event: { k: "err", t: 1, at: "stores/watcher", msg: "구독 실패", lvl: "warn" },
    });
  });

  it("새 형태는 lvl 을 직접 쓴다", () => {
    const r = parseLine('{"k":"err","t":1,"at":"a","msg":"x","lvl":"warn"}');
    expect(r).toEqual({ ok: true, event: { k: "err", t: 1, at: "a", msg: "x", lvl: "warn" } });
  });

  it("lvl 이 없으면 오류다", () => {
    const r = parseLine('{"k":"err","t":1,"at":"a","msg":"x"}');
    expect(r.ok && r.event.k === "err" && r.event.lvl).toBeUndefined();
  });
});

/**
 * 🔴 **"모르는 종류"와 "깨진 줄"은 다른 사건이다.**
 *
 * 앞으로 종류가 계속 는다. 옛 버전으로 되돌리면 새 종류가 전부 `null` 이 되고, 지금
 * 구조에서는 그게 "손상된 줄 5000개"로 보인다 — 멀쩡한 로그를 손상이라고 말하는 셈이다.
 */
describe("못 읽는 줄을 가른다", () => {
  it("JSON 이 아니면 malformed", () => {
    expect(parseLine("이건 JSON 이 아니다")).toEqual({ ok: false, reason: "malformed" });
  });

  it("필드가 모자라면 malformed", () => {
    expect(parseLine('{"k":"cmd","t":1}')).toEqual({ ok: false, reason: "malformed" });
  });

  it("t 가 없으면 malformed", () => {
    expect(parseLine('{"k":"cmd","id":"a","via":"keymap"}')).toEqual({ ok: false, reason: "malformed" });
  });

  it("모르는 종류는 unknown-kind — 손상이 아니다", () => {
    expect(parseLine('{"k":"미래종류","t":1,"뭔가":true}')).toEqual({
      ok: false,
      reason: "unknown-kind",
    });
  });

  it("모르는 via 는 malformed — 열거형이 깨진 것이다", () => {
    expect(parseLine('{"k":"cmd","t":1,"id":"a","via":"없는입구"}')).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});

describe("monthOf", () => {
  it("YYYY-MM", () => {
    expect(monthOf(Date.parse("2026-03-05T10:00:00"))).toBe("2026-03");
  });

  it("한 자리 달을 0 으로 채운다", () => {
    expect(monthOf(Date.parse("2026-01-31T23:00:00"))).toBe("2026-01");
  });
});

describe("redact", () => {
  it("경로는 마지막 조각만 남긴다", () => {
    expect(redact("C:/Projects/SharedDocs/knowledge/lapis/a.md")).toBe("…/a.md");
  });

  /**
   * 🔴 **사용자 이름이 남으면 안 된다.**
   *
   * 예전엔 경로 규칙이 먼저 돌아 사용자 이름 규칙이 사실상 죽어 있었고,
   * `/Users/누군가` 처럼 조각이 둘뿐인 경로는 "마지막 조각만 남긴다"에 걸려
   * **이름이 그대로 남았다.** 가림의 목적이 정확히 그것을 막는 것이다.
   */
  it("사용자 이름이 남지 않는다 — 깊은 경로", () => {
    expect(redact("/Users/누군가/notes/a.md")).not.toContain("누군가");
  });

  it("사용자 이름이 남지 않는다 — 홈 경로 그 자체", () => {
    expect(redact("/Users/누군가")).not.toContain("누군가");
    expect(redact("C:/Users/누군가")).not.toContain("누군가");
    expect(redact("/home/누군가")).not.toContain("누군가");
  });

  /**
   * 🔴 **질의문도 가려야 한다.**
   *
   * 질의문은 생각의 내용 그 자체다. 경로만 가리고 질의를 그대로 두면, 가린 리포트가
   * **가려졌다고 거짓말**을 한다.
   */
  it("질의문을 길이만 남긴다", () => {
    expect(redact("검색어 일곱자", { query: true })).toBe("…(7자)");
  });

  it("질의 모드가 아니면 그대로 둔다", () => {
    expect(redact("보통 글")).toBe("보통 글");
  });

  it("빈 질의는 빈 채로", () => {
    expect(redact("", { query: true })).toBe("");
  });
});

describe("입구 목록", () => {
  /** ⚠️ 타입과 런타임 배열이 갈리면 `parseLine` 이 멀쩡한 줄을 버린다. */
  it("비어 있지 않다", () => {
    expect(COMMAND_SURFACES.length).toBeGreaterThan(0);
  });

  it("중복이 없다", () => {
    expect(new Set(COMMAND_SURFACES).size).toBe(COMMAND_SURFACES.length);
  });
});
