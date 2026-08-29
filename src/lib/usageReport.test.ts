import { describe, it, expect } from "vitest";
import { buildUsageReport } from "./usageReport";
import { summarize } from "./usageAnalyzer";
import { serialize } from "./usageSchema";

/**
 * 분석 문서.
 *
 * ## ⚠️ 가리지 않는다
 *
 * 예전엔 기본이 가림이고 `raw` 를 줘야 원본이 나왔다. 그때는 **저장 버튼으로 밖에 내보내는
 * 경로**가 있었기 때문이다. 지금은 앱이 로그 옆에 써 두고 끝이라 나갈 경계가 없다 —
 * 자기가 읽을 것을 가리면 쓸모만 준다.
 *
 * 대신 문서 머리가 **가리지 않았다는 사실을 밝힌다.** 그걸 안 적으면 그대로 어디에
 * 붙여넣게 된다.
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
   * 🔴 **질의문이 그대로 나온다.**
   *
   * 무엇을 찾다 못 찾았는지가 이 통계의 요점이고, 길이만 남기면 그 답이 사라진다.
   * 대신 문서 머리가 "그대로 들어 있다"고 밝힌다.
   */
  it("질의문이 그대로 나온다", () => {
    const s = summarize([serialize({ k: "query", t: 1, kind: "fulltext", q: "비밀검색어", n: 0 })]);
    expect(buildUsageReport(s)).toContain("비밀검색어");
  });

  it("결과 0건 질의를 절로 낸다", () => {
    const s = summarize([
      serialize({ k: "query", t: 1, kind: "quick", q: "없는말", n: 0 }),
      serialize({ k: "query", t: 2, kind: "quick", q: "없는말", n: 0 }),
    ]);
    const r = buildUsageReport(s);
    expect(r).toContain("결과가 0건이던 질의");
    expect(r).toContain("없는말");
  });

  it("열람과 입구를 절로 낸다", () => {
    const s = summarize([
      serialize({ k: "open", t: 1, path: "/v/a.md", via: "backlink" }),
      serialize({ k: "open", t: 2, path: "/v/a.md", via: "tree" }),
    ]);
    const r = buildUsageReport(s);
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

describe("🔴 가리지 않는다", () => {
  it("오류 메시지의 경로가 온전하다", () => {
    const r = buildUsageReport(summary);
    expect(r).toContain("knowledge/lapis");
    expect(r).toContain("STATE.md");
    expect(r).toContain("readNote 실패");
  });

  /**
   * 🔴 **경로가 그대로 나온다.** "어느 폴더를 많이 쓰나"는 기능 개선에 쓸 첫 번째
   * 질문이고, 가리면 그 답이 사라진다. 이 문서는 앱 데이터 폴더를 안 벗어난다.
   */
  it("경로를 가리지 않는다", () => {
    expect(buildUsageReport(summary)).toContain("C:/Projects/SharedDocs");
  });

  /** ⚠️ **가리지 않았다는 사실을 밝힌다.** 안 적으면 그대로 어디에 붙여넣게 된다. */
  it("가리지 않았다고 문서가 말한다", () => {
    expect(buildUsageReport(summary)).toMatch(/그대로 들어 있다/);
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
