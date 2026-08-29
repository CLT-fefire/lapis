import { describe, it, expect } from "vitest";
import { buildUsageReport } from "./usageReport";
import { summarize } from "./usageAnalyzer";
import { serialize } from "./usageSchema";

/**
 * 리포트 — **가림의 경계**.
 *
 * 로그 원본은 자세하다(로컬, 나중에 쓴다). 사고는 **이 문서를 붙여넣는 순간** 난다.
 * 그래서 기본이 가림이고, 원본은 명시해야 나온다.
 */

const lines = [
  serialize({ k: "session", t: Date.parse("2026-08-01"), ev: "start", v: "3.1.2", os: "windows" }),
  serialize({ k: "cmd", t: Date.parse("2026-08-02"), id: "quick-open", via: "keymap" }),
  serialize({ k: "cmd", t: Date.parse("2026-08-02"), id: "quick-open", via: "keymap" }),
  serialize({ k: "cmd", t: Date.parse("2026-08-03"), id: "quick-open", via: "palette" }),
  serialize({ k: "cmd", t: Date.parse("2026-08-03"), id: "table-view", via: "rail" }),
  serialize({
    k: "err",
    t: Date.parse("2026-08-04"),
    at: "stores/vault",
    msg: "readNote 실패 C:/Projects/SharedDocs/knowledge/lapis/STATE.md",
  }),
  "깨진 줄",
];

const summary = summarize(lines, ["quick-open", "table-view", "reset-layout"]);

describe("리포트 내용", () => {
  it("기간과 총계를 담는다", () => {
    const r = buildUsageReport(summary, { label: "2026-08" });
    expect(r).toContain("2026-08");
    expect(r).toContain("2026-08-01");
    expect(r).toContain("2026-08-04");
  });

  /** 🔴 입구가 이 통계의 요점이다. */
  it("입구 분포를 담는다", () => {
    const r = buildUsageReport(summary);
    expect(r).toMatch(/keymap 2/);
    expect(r).toMatch(/palette 1/);
  });

  /** ⚠️ 안 쓴 명령은 로그에 없다 — 분모가 있어야 보인다. */
  it("한 번도 안 쓴 명령을 담는다", () => {
    expect(buildUsageReport(summary)).toContain("reset-layout");
  });

  /** ⚠️ 못 읽은 줄을 조용히 빼면 통계가 거짓말이 된다. */
  it("깨진 줄이 있으면 말한다", () => {
    expect(buildUsageReport(summary)).toMatch(/깨진 줄/);
  });

  /**
   * 🔴 **"모르는 종류"는 손상이 아니다** — 더 새 버전이 쓴 줄이라는 뜻이다.
   * 합쳐 적으면 옛 버전으로 되돌렸을 때 멀쩡한 로그를 손상이라고 말하게 된다.
   */
  it("모르는 종류를 손상과 갈라 적는다", () => {
    const r = buildUsageReport(summarize([...lines, '{"k":"미래종류","t":1}']));
    expect(r).toMatch(/모르는 종류/);
    expect(r).toMatch(/손상이 아니다/);
    expect(r).toMatch(/깨진 줄/);
  });

  /** 손상이 없으면 그 줄도 없어야 한다 — 0 을 적으면 눈이 그 자리를 계속 본다. */
  it("깨진 줄이 없으면 그 칸을 안 낸다", () => {
    const clean = summarize([
      serialize({ k: "cmd", t: 1, id: "a", via: "keymap" }),
    ]);
    expect(buildUsageReport(clean)).not.toMatch(/깨진 줄/);
  });

  /**
   * 🔴 **질의문은 경로 규칙으로 안 가려진다.**
   *
   * 질의는 경로처럼 안 생겼다. 경로만 가리고 질의를 그대로 두면 가린 리포트가
   * **가려졌다고 거짓말**을 한다 — 그리고 질의문은 생각의 내용 그 자체다.
   */
  it("가리면 질의문이 길이만 남는다", () => {
    const s = summarize([serialize({ k: "query", t: 1, kind: "fulltext", q: "비밀검색어", n: 0 })]);
    const hidden = buildUsageReport(s);
    expect(hidden, "질의문이 그대로 남았다").not.toContain("비밀검색어");
    expect(hidden).toMatch(/…\(5자\)/);
  });

  it("가리지 않으면 질의문이 그대로다", () => {
    const s = summarize([serialize({ k: "query", t: 1, kind: "fulltext", q: "비밀검색어", n: 0 })]);
    expect(buildUsageReport(s, { raw: true })).toContain("비밀검색어");
  });

  it("결과 0건 질의를 절로 낸다", () => {
    const s = summarize([
      serialize({ k: "query", t: 1, kind: "quick", q: "없는말", n: 0 }),
      serialize({ k: "query", t: 2, kind: "quick", q: "없는말", n: 0 }),
    ]);
    const r = buildUsageReport(s, { raw: true });
    expect(r).toContain("결과가 0건이던 질의");
    expect(r).toContain("없는말");
  });

  it("열람과 입구를 절로 낸다", () => {
    const s = summarize([
      serialize({ k: "open", t: 1, path: "/v/a.md", via: "backlink" }),
      serialize({ k: "open", t: 2, path: "/v/a.md", via: "tree" }),
    ]);
    const r = buildUsageReport(s, { raw: true });
    expect(r).toContain("자주 여는 노트");
    expect(r).toMatch(/backlink 1/);
  });

  /** ⚠️ 평균만 내면 드문 느림이 묻힌다 — 최댓값이 같이 나와야 한다. */
  it("성능은 평균과 최대를 같이 낸다", () => {
    const s = summarize([
      serialize({ k: "perf", t: 1, op: "index-build", ms: 100, n: 10 }),
      serialize({ k: "perf", t: 2, op: "index-build", ms: 5000, n: 10 }),
    ]);
    const r = buildUsageReport(s);
    expect(r).toContain("성능");
    expect(r).toMatch(/5\.0초/);
  });

  it("경고를 오류와 갈라 적는다", () => {
    const s = summarize([
      serialize({ k: "err", t: 1, at: "x", msg: "터짐" }),
      serialize({ k: "err", t: 2, at: "y", msg: "조심", lvl: "warn" }),
    ]);
    const r = buildUsageReport(s);
    expect(r).toMatch(/\| 경고 \|/);
    expect(r).toMatch(/\| 오류 \|/);
  });

  it("기록이 없어도 문서가 나온다", () => {
    const r = buildUsageReport(summarize([]));
    expect(r).toContain("# 사용 통계");
    expect(r).toContain("아직 기록이 없다");
  });
});

describe("🔴 기본은 가림", () => {
  it("경로가 그대로 나오지 않는다", () => {
    const r = buildUsageReport(summary);
    expect(r).not.toContain("C:/Projects/SharedDocs");
    expect(r).not.toContain("knowledge/lapis");
    expect(r).toContain("STATE.md");
  });

  /** ⚠️ 가려도 어떤 오류인지는 구별돼야 한다 — 안 그러면 리포트가 쓸모없다. */
  it("가려도 오류를 알아볼 수 있다", () => {
    expect(buildUsageReport(summary)).toContain("readNote 실패");
  });

  /** ⚠️ 원본은 **명시**해야 나온다. 기본이 원본이면 급할 때 안전한 쪽을 놓친다. */
  it("raw 를 줘야 원본이 나온다", () => {
    const r = buildUsageReport(summary, { raw: true });
    expect(r).toContain("C:/Projects/SharedDocs");
    expect(r).toMatch(/공개된 곳에 붙여넣지 말 것/);
  });

  it("기본 문서는 가렸다는 것을 밝힌다", () => {
    expect(buildUsageReport(summary)).toMatch(/가렸다/);
  });
});

describe("상한", () => {
  it("top 을 넘으면 자르고 남은 수를 말한다", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      serialize({ k: "cmd", t: 1, id: `c${i}`, via: "palette" }),
    );
    const r = buildUsageReport(summarize(many), { top: 5 });
    expect(r).toMatch(/외 25개/);
  });
});
