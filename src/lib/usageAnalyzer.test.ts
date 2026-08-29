import { describe, it, expect } from "vitest";
import { UsageAnalyzer, summarize } from "./usageAnalyzer";
import { serialize, type UsageEvent } from "./usageSchema";

/**
 * 사용 로그의 **집계**.
 *
 * ## ⚠️ 왜 클래스인가 — 달을 하나씩 흘려보내야 한다
 *
 * 예전엔 `SettingsModal` 이 모든 달을 한 배열로 모아 한 번에 넘겼다. 월 파일 상한이
 * 16 MB 이므로 열두 달이면 최악 192 MB 의 문자열 배열이다. 종류가 늘면 **여기가 먼저
 * 터진다.** `feed(line)` 이 상태를 누적하면 호출부가 달마다 읽어 먹이고 버릴 수 있다.
 *
 * 그래서 이 파일의 가장 중요한 단언은 **"나눠 먹여도 같은 결과"** 다. 그게 깨지면
 * 스트리밍이 조용히 다른 답을 낸다.
 */

const line = (e: UsageEvent) => serialize(e);

const CMD = (t: number, id: string, via: "keymap" | "palette" = "keymap"): string =>
  line({ k: "cmd", t, id, via });

describe("명령", () => {
  it("입구별로 센다", () => {
    const a = new UsageAnalyzer();
    a.feed(CMD(1, "quick-open", "keymap"));
    a.feed(CMD(2, "quick-open", "keymap"));
    a.feed(CMD(3, "quick-open", "palette"));
    const r = a.result();
    expect(r.commands[0]).toEqual({ id: "quick-open", total: 3, via: { keymap: 2, palette: 1 } });
  });

  it("많이 쓴 순서", () => {
    const a = new UsageAnalyzer();
    a.feed(CMD(1, "a"));
    a.feed(CMD(2, "b"));
    a.feed(CMD(3, "b"));
    expect(a.result().commands.map((c) => c.id)).toEqual(["b", "a"]);
  });

  /** 안 쓴 명령을 세려면 **분모**가 필요하다 — 로그만 보면 안 쓴 것은 애초에 안 보인다. */
  it("한 번도 안 쓴 명령을 낸다", () => {
    const a = new UsageAnalyzer({ knownCommands: ["a", "b", "c"] });
    a.feed(CMD(1, "b"));
    expect(a.result().unusedCommands).toEqual(["a", "c"]);
  });
});

describe("오류와 경고", () => {
  /** 🔴 심각도가 갈려야 "무엇이 자주 깨지나"의 답이 맞는다. */
  it("경고와 오류를 따로 센다", () => {
    const a = new UsageAnalyzer();
    a.feed(line({ k: "err", t: 1, at: "x", msg: "터짐" }));
    a.feed(line({ k: "err", t: 2, at: "y", msg: "조심", lvl: "warn" }));
    const r = a.result();
    expect(r.errorCount).toBe(1);
    expect(r.warnCount).toBe(1);
  });

  it("같은 자리·같은 말은 한 줄로 묶고 마지막 시각을 든다", () => {
    const a = new UsageAnalyzer();
    a.feed(line({ k: "err", t: 10, at: "x", msg: "같음" }));
    a.feed(line({ k: "err", t: 30, at: "x", msg: "같음" }));
    a.feed(line({ k: "err", t: 20, at: "x", msg: "같음" }));
    const [e] = a.result().errors;
    expect(e.count).toBe(3);
    expect(e.lastAt).toBe(30);
  });

  /** ⚠️ 심각도가 다르면 **다른 줄**이다 — 합치면 경고가 오류로 보인다. */
  it("경고와 오류는 같은 말이어도 안 합친다", () => {
    const a = new UsageAnalyzer();
    a.feed(line({ k: "err", t: 1, at: "x", msg: "같음" }));
    a.feed(line({ k: "err", t: 2, at: "x", msg: "같음", lvl: "warn" }));
    expect(a.result().errors).toHaveLength(2);
  });
});

describe("검색", () => {
  it("종류별로 세고 결과 없는 질의를 따로 든다", () => {
    const a = new UsageAnalyzer();
    a.feed(line({ k: "query", t: 1, kind: "fulltext", q: "찾는말", n: 0 }));
    a.feed(line({ k: "query", t: 2, kind: "fulltext", q: "찾는말", n: 0 }));
    a.feed(line({ k: "query", t: 3, kind: "quick", q: "노트", n: 5, hit: true }));
    const r = a.result();
    expect(r.queries.byKind).toEqual({ fulltext: 2, quick: 1 });
    // 🔴 0건이 반복되는 질의가 곧 개선 지점이다.
    expect(r.queries.empty[0]).toEqual({ q: "찾는말", kind: "fulltext", count: 2 });
  });

  /** 결과가 있었는데 아무것도 안 열었으면 **못 찾은 것**이다. */
  it("열지 않은 비율을 낸다", () => {
    const a = new UsageAnalyzer();
    a.feed(line({ k: "query", t: 1, kind: "quick", q: "a", n: 3, hit: true }));
    a.feed(line({ k: "query", t: 2, kind: "quick", q: "b", n: 3, hit: false }));
    a.feed(line({ k: "query", t: 3, kind: "quick", q: "c", n: 3, hit: false }));
    expect(a.result().queries.missRate).toBeCloseTo(2 / 3, 5);
  });

  it("질의가 없으면 missRate 는 null", () => {
    expect(new UsageAnalyzer().result().queries.missRate).toBeNull();
  });

  /**
   * 🔴 **`hit` 가 없는 옛 줄은 분모에서 뺀다.**
   *
   * v3.6.0 이전 로그에는 `hit` 가 없다. 없는 것을 "안 열었다"로 세면 비율이 조용히
   * 부풀어 오르고, "검색이 잘 안 맞는다"는 틀린 결론이 나온다.
   */
  it("hit 이 없는 옛 줄은 비율에 안 넣는다", () => {
    const a = new UsageAnalyzer();
    a.feed('{"k":"query","t":1,"kind":"quick","q":"옛줄","n":5}');
    a.feed('{"k":"query","t":2,"kind":"quick","q":"옛줄","n":5}');
    a.feed(line({ k: "query", t: 3, kind: "quick", q: "새줄", n: 5, hit: true }));
    // 분모는 hit 이 실린 한 건뿐이고, 그건 열었다 → 0.
    expect(a.result().queries.missRate).toBe(0);
  });

  it("hit 이 하나도 없으면 missRate 는 null", () => {
    const a = new UsageAnalyzer();
    a.feed('{"k":"query","t":1,"kind":"quick","q":"옛줄","n":5}');
    expect(a.result().queries.missRate).toBeNull();
  });
});

describe("열람", () => {
  it("경로별로 세고 입구를 든다", () => {
    const a = new UsageAnalyzer();
    a.feed(line({ k: "open", t: 1, path: "/v/a.md", via: "tree" }));
    a.feed(line({ k: "open", t: 2, path: "/v/a.md", via: "palette" }));
    a.feed(line({ k: "open", t: 3, path: "/v/b.md", via: "tree" }));
    const r = a.result();
    expect(r.opens[0]).toEqual({ path: "/v/a.md", total: 2, via: { tree: 1, palette: 1 } });
    expect(r.openVia).toEqual({ tree: 2, palette: 1 });
  });
});

describe("성능", () => {
  /** ⚠️ 평균만 내면 드문 느림이 묻힌다. 최댓값을 같이 든다. */
  it("작업별 횟수·평균·최댓값", () => {
    const a = new UsageAnalyzer();
    a.feed(line({ k: "perf", t: 1, op: "index-build", ms: 100, n: 10 }));
    a.feed(line({ k: "perf", t: 2, op: "index-build", ms: 300, n: 10 }));
    const [p] = a.result().perf;
    expect(p).toEqual({ op: "index-build", count: 2, avgMs: 200, maxMs: 300 });
  });
});

describe("세션", () => {
  /**
   * 🔴 **길이는 타임스탬프에서 계산한다 — 끝 이벤트가 아니라.**
   *
   * 닫을 때 무언가를 남기려면 창을 붙잡아야 하고, 실제로 그렇게 해서 **X 버튼이 안 먹는
   * 앱**을 만들었다(v3.7.0). 관찰 장치 하나 때문에 앱을 못 닫게 되는 것은 어떤 로그보다
   * 나쁘다. 마지막 이벤트까지의 시간은 "실제로 쓴 시간"이라 오히려 더 정직하다.
   */
  it("시작부터 마지막 이벤트까지를 길이로 본다", () => {
    const a = new UsageAnalyzer();
    a.feed(line({ k: "session", t: 1000, ev: "start", v: "3.8.0", os: "windows" }));
    a.feed(CMD(3000, "a"));
    const r = a.result();
    expect(r.sessions).toBe(1);
    expect(r.avgSessionMs).toBe(2000);
  });

  it("세션이 여럿이면 평균낸다", () => {
    const a = new UsageAnalyzer();
    a.feed(line({ k: "session", t: 0, ev: "start", v: "3.8.0", os: "windows" }));
    a.feed(CMD(1000, "a"));
    a.feed(line({ k: "session", t: 5000, ev: "start", v: "3.8.0", os: "windows" }));
    a.feed(CMD(8000, "b"));
    expect(a.result().avgSessionMs).toBe(2000);
  });

  /** ⚠️ 마지막 세션은 아직 안 끝났다 — 안 세면 통계에서 통째로 빠진다. */
  it("마지막(안 끝난) 세션도 센다", () => {
    const a = new UsageAnalyzer();
    a.feed(line({ k: "session", t: 0, ev: "start", v: "3.8.0", os: "windows" }));
    a.feed(CMD(4000, "a"));
    expect(a.result().avgSessionMs).toBe(4000);
  });

  it("이벤트가 시작 하나뿐이면 길이가 없다", () => {
    const a = new UsageAnalyzer();
    a.feed(line({ k: "session", t: 1, ev: "start", v: "3.8.0", os: "windows" }));
    expect(a.result().avgSessionMs).toBeNull();
  });

  /** v3.7.0 이 쓴 끝 이벤트. 지금은 안 쓰지만 **이미 쌓인 줄은 읽는다.** */
  it("옛 끝 이벤트의 ms 도 읽는다", () => {
    const a = new UsageAnalyzer();
    a.feed('{"k":"session","t":9,"ev":"end","v":"3.7.0","os":"windows","ms":6000}');
    expect(a.result().avgSessionMs).toBe(6000);
  });
});

/**
 * 🔴 **"못 읽은 줄"과 "모르는 종류"를 갈라 센다.**
 *
 * 합쳐 세면 옛 버전으로 되돌렸을 때 멀쩡한 로그가 "손상"으로 보인다.
 */
describe("못 읽은 줄", () => {
  it("깨진 줄과 모르는 종류를 따로 센다", () => {
    const a = new UsageAnalyzer();
    a.feed("이건 JSON 이 아니다");
    a.feed('{"k":"미래종류","t":1}');
    a.feed(CMD(1, "a"));
    const r = a.result();
    expect(r.malformed).toBe(1);
    expect(r.unknownKind).toBe(1);
    expect(r.events).toBe(1);
  });

  /** ⚠️ 못 읽은 줄을 조용히 빼면 통계가 거짓말이 된다 — 화면이 말해야 한다. */
  it("합계도 그대로 낸다", () => {
    const a = new UsageAnalyzer();
    a.feed("깨짐");
    a.feed('{"k":"미래","t":1}');
    expect(a.result().unreadable).toBe(2);
  });
});

describe("기간", () => {
  it("가장 이른 것과 늦은 것", () => {
    const a = new UsageAnalyzer();
    a.feed(CMD(500, "a"));
    a.feed(CMD(100, "b"));
    a.feed(CMD(300, "c"));
    const r = a.result();
    expect(r.from).toBe(100);
    expect(r.to).toBe(500);
  });

  it("아무것도 없으면 null", () => {
    const r = new UsageAnalyzer().result();
    expect(r.from).toBeNull();
    expect(r.to).toBeNull();
  });
});

/**
 * 🔴 **나눠 먹여도 같은 결과여야 한다.**
 *
 * 이 클래스를 만든 이유가 달마다 흘려보내는 것이다. 이 단언이 깨지면 스트리밍이 조용히
 * 다른 답을 낸다 — 한 번에 먹인 결과와 비교할 일이 없으니 아무도 모른다.
 */
describe("스트리밍", () => {
  const lines = [
    CMD(1, "a"),
    line({ k: "query", t: 2, kind: "quick", q: "x", n: 0 }),
    line({ k: "err", t: 3, at: "m", msg: "e" }),
    line({ k: "open", t: 4, path: "/p.md", via: "tree" }),
    line({ k: "perf", t: 5, op: "vault-open", ms: 7 }),
    "깨진 줄",
    CMD(6, "a"),
  ];

  it("한 번에 vs 조각으로 — 같다", () => {
    const whole = new UsageAnalyzer({ knownCommands: ["a", "b"] });
    for (const l of lines) whole.feed(l);

    const chunked = new UsageAnalyzer({ knownCommands: ["a", "b"] });
    chunked.feedAll(lines.slice(0, 3));
    chunked.feedAll(lines.slice(3, 5));
    chunked.feedAll(lines.slice(5));

    expect(chunked.result()).toEqual(whole.result());
  });

  it("result() 를 두 번 불러도 같다", () => {
    const a = new UsageAnalyzer();
    a.feedAll(lines);
    expect(a.result()).toEqual(a.result());
  });
});

/** 옛 호출부를 위한 얇은 감싸개 — 한 번에 넘기는 경로도 남긴다. */
describe("summarize", () => {
  it("클래스와 같은 답", () => {
    const lines = [CMD(1, "a"), CMD(2, "a"), "깨짐"];
    const a = new UsageAnalyzer({ knownCommands: ["a", "z"] });
    a.feedAll(lines);
    expect(summarize(lines, ["a", "z"])).toEqual(a.result());
  });
});
