import { describe, it, expect } from "vitest";
import { buildUsageReport } from "./usageReport";
import { summarize, serialize } from "./usageEvent";

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
  it("못 읽은 줄이 있으면 말한다", () => {
    expect(buildUsageReport(summary)).toMatch(/못 읽은 줄/);
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
