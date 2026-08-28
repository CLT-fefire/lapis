import { describe, it, expect } from "vitest";
import {
  serialize,
  parseLine,
  monthOf,
  summarize,
  redact,
  errorLine,
  COMMAND_SURFACES,
  type UsageEvent,
} from "./usageEvent";

/**
 * 사용 로그의 스키마와 집계.
 *
 * ⚠️ 이 로그는 **몇 달치가 쌓인 뒤에** 쓰인다. 스키마가 조용히 틀리면 그때 가서야
 * 드러나고, 그 시점에는 이미 되돌릴 수 없다 — 안 담긴 것은 안 담긴 것이다.
 */

const cmd = (id: string, via: UsageEvent extends { via: infer V } ? V : never, t = 1): UsageEvent =>
  ({ k: "cmd", t, id, via }) as UsageEvent;

describe("직렬화 왕복", () => {
  it("세 종류가 왕복한다", () => {
    const events: UsageEvent[] = [
      { k: "cmd", t: 1, id: "quick-open", via: "keymap" },
      { k: "err", t: 2, at: "stores/vault", msg: "movePath failed", detail: "EACCES", path: "/v/a.md" },
      { k: "session", t: 3, ev: "start", v: "3.1.2", os: "windows" },
    ];
    for (const e of events) expect(parseLine(serialize(e))).toEqual(e);
  });

  /**
   * 🔴 **개행이 섞이면 한 줄 = 한 이벤트가 깨진다.** 예외 메시지에는 스택이 통째로
   * 들어올 수 있어 실제로 자주 생긴다. Rust 쪽은 그런 줄을 **버리므로** 여기서 안 막으면
   * 그 이벤트가 조용히 사라진다.
   */
  it("개행이 든 값도 한 줄로 나온다", () => {
    const e: UsageEvent = { k: "err", t: 1, at: "a", msg: "b", detail: "line1\nline2\r\nline3" };
    const line = serialize(e);
    expect(line).not.toMatch(/[\n\r]/);
    expect(parseLine(line)?.k).toBe("err");
  });
});

describe("parseLine — 던지지 않는다", () => {
  /** ⚠️ 한 줄이 깨졌다고 그 달 전체를 못 보면 로그를 남긴 뜻이 사라진다. */
  it("쓰레기는 null 이지 예외가 아니다", () => {
    for (const bad of ["", "{{{", "null", "[]", "3", '{"k":"cmd"}', '{"t":1}']) {
      expect(() => parseLine(bad)).not.toThrow();
      expect(parseLine(bad), bad).toBeNull();
    }
  });

  it("모르는 종류는 null", () => {
    expect(parseLine('{"k":"미래","t":1}')).toBeNull();
  });

  /** ⚠️ 입구가 목록 밖이면 통계의 분모가 틀린다 — 조용히 받지 않는다. */
  it("모르는 입구는 null", () => {
    expect(parseLine('{"k":"cmd","t":1,"id":"x","via":"텔레파시"}')).toBeNull();
    for (const via of COMMAND_SURFACES) {
      expect(parseLine(`{"k":"cmd","t":1,"id":"x","via":"${via}"}`)).not.toBeNull();
    }
  });

  it("선택 필드가 없어도 읽는다", () => {
    expect(parseLine('{"k":"err","t":1,"at":"a","msg":"b"}')).toEqual({
      k: "err",
      t: 1,
      at: "a",
      msg: "b",
    });
  });
});

describe("monthOf", () => {
  it("YYYY-MM 이고 한 자리 달을 0으로 채운다", () => {
    expect(monthOf(new Date(2026, 0, 15).getTime())).toBe("2026-01");
    expect(monthOf(new Date(2026, 11, 1).getTime())).toBe("2026-12");
  });

  /** ⚠️ Rust 쪽이 길이 7 · 5번째가 `-` 인 것만 받는다. 형식이 갈리면 append 가 실패한다. */
  it("Rust 가 받는 형식과 같다", () => {
    const m = monthOf(Date.parse("2026-08-28T00:00:00"));
    expect(m).toHaveLength(7);
    expect(m[4]).toBe("-");
  });
});

describe("summarize", () => {
  const lines = [
    serialize({ k: "session", t: 10, ev: "start", v: "3.1.2", os: "windows" }),
    serialize({ k: "cmd", t: 11, id: "quick-open", via: "keymap" }),
    serialize({ k: "cmd", t: 12, id: "quick-open", via: "keymap" }),
    serialize({ k: "cmd", t: 13, id: "quick-open", via: "palette" }),
    serialize({ k: "cmd", t: 14, id: "table-view", via: "rail" }),
    serialize({ k: "err", t: 15, at: "stores/vault", msg: "readNote failed" }),
    serialize({ k: "err", t: 16, at: "stores/vault", msg: "readNote failed" }),
    "깨진 줄",
  ];

  it("총계와 기간을 낸다", () => {
    const s = summarize(lines);
    expect(s.events).toBe(7);
    expect(s.from).toBe(10);
    expect(s.to).toBe(16);
    expect(s.sessions).toBe(1);
  });

  /** ⚠️ 못 읽은 줄을 조용히 빼면 통계가 거짓말이 된다 — 세어서 보여준다. */
  it("못 읽은 줄을 센다", () => {
    expect(summarize(lines).unreadable).toBe(1);
  });

  /** 🔴 **이게 이 통계의 요점이다** — 어느 입구로 들어왔나. */
  it("입구별로 가른다", () => {
    const s = summarize(lines);
    const qo = s.commands.find((c) => c.id === "quick-open")!;
    expect(qo.total).toBe(3);
    expect(qo.via).toEqual({ keymap: 2, palette: 1 });
  });

  it("많이 쓴 순서로 낸다", () => {
    expect(summarize(lines).commands.map((c) => c.id)).toEqual(["quick-open", "table-view"]);
  });

  it("오류를 자리+메시지로 묶고 마지막 시각을 든다", () => {
    const e = summarize(lines).errors[0];
    expect(e.count).toBe(2);
    expect(e.lastAt).toBe(16);
  });

  /**
   * 🔴 **분모가 없으면 "안 쓴 명령"은 애초에 안 보인다.** 로그에는 쓴 것만 남는다 —
   * 그래서 아는 명령 전체를 받아야 한다.
   */
  it("안 쓰인 명령을 낸다", () => {
    const s = summarize(lines, ["quick-open", "table-view", "reset-layout", "new-window"]);
    expect(s.unusedCommands).toEqual(["new-window", "reset-layout"]);
  });

  it("빈 로그에도 안 죽는다", () => {
    const s = summarize([]);
    expect(s.events).toBe(0);
    expect(s.from).toBeNull();
    expect(s.commands).toEqual([]);
  });
});

describe("🔴 redact — 리포트 경계", () => {
  /**
   * 로그 **원본**은 자세하다(로컬이고 나중에 쓴다). 사고는 **리포트를 붙여넣는 순간**
   * 난다 — 이 저장소는 공개이고, vault 경로는 구조를 그대로 드러낸다.
   */
  it("절대 경로를 마지막 조각만 남긴다", () => {
    expect(redact("C:/Projects/SharedDocs/knowledge/lapis/STATE.md")).toBe("…/STATE.md");
    expect(redact("/Users/someone/vault/notes/a.md")).toBe("…/a.md");
  });

  it("사용자 이름을 지운다", () => {
    expect(redact("C:\\Users\\someone\\AppData")).not.toMatch(/someone/);
  });

  it("경로가 아닌 글자는 안 건드린다", () => {
    expect(redact("readNote failed: EACCES")).toBe("readNote failed: EACCES");
  });

  /** ⚠️ 가린 뒤에도 **통계는 그대로** 쓸 수 있어야 한다 — 개수는 경로를 몰라도 된다. */
  it("가려도 오류를 구별할 수 있다", () => {
    const a = errorLine({ at: "stores/vault", msg: "readNote failed /v/a.md", count: 1, lastAt: 1 });
    const b = errorLine({ at: "stores/vault", msg: "writeNote failed /v/a.md", count: 1, lastAt: 1 });
    expect(a).not.toBe(b);
  });

  /** ⚠️ 원본을 내보내려면 **명시적으로 요구**해야 한다 — 기본이 가림이다. */
  it("raw 는 부르는 쪽이 명시해야 한다", () => {
    const e = { at: "a", msg: "C:/Projects/vault/x.md", count: 1, lastAt: 1 };
    expect(errorLine(e)).toContain("…/");
    expect(errorLine(e, true)).toContain("C:/Projects/vault/x.md");
  });
});
