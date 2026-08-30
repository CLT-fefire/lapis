import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * 분석 문서를 앱이 알아서 쓰는 자리.
 *
 * ## 🔴 관찰 장치는 대상을 죽이면 안 된다
 *
 * 이 저장소가 그걸로 한 번 당했다 — 세션 길이를 남기려고 건 닫기 훅이 **창을 붙잡아
 * 앱이 안 닫혔다**(v3.7.1). 그래서 여기 규칙이 둘이다: 기동 때 쓴다, 그리고 **실패해도
 * 던지지 않는다.** 문서를 못 썼다고 앱이 안 뜨면 관찰이 대상을 죽인 것이다.
 *
 * ⚠️ 그 "안 던진다"가 지켜지는지는 **읽어서는 알 수 없다.** 던지게 만들어 봐야 한다.
 */

const usageMonths = vi.fn<() => Promise<{ months: string[] }>>();
const usageRead = vi.fn<(m: string) => Promise<string>>();
const usageWriteReport = vi.fn<(s: string) => Promise<void>>();
const logWarn = vi.fn();

vi.mock("$lib/tauri/usage", () => ({
  usageMonths: () => usageMonths(),
  usageRead: (m: string) => usageRead(m),
  usageWriteReport: (s: string) => usageWriteReport(s),
}));
vi.mock("$lib/stores/usage", () => ({ logWarn: (...a: unknown[]) => logWarn(...a) }));

const { writeUsageAnalysis, REPORT_NAME } = await import("./usageAutoReport");

beforeEach(() => {
  usageMonths.mockReset().mockResolvedValue({ months: [] });
  usageRead.mockReset().mockResolvedValue("");
  usageWriteReport.mockReset().mockResolvedValue(undefined);
  logWarn.mockReset();
});

describe("쓸 것이 없으면 안 쓴다", () => {
  /** ⚠️ 빈 문서를 쓰면 "기록이 없다"와 "집계가 실패했다"가 구별이 안 된다. */
  it("달이 하나도 없으면 false 이고 아무것도 안 쓴다", async () => {
    usageMonths.mockResolvedValue({ months: [] });
    await expect(writeUsageAnalysis([])).resolves.toBe(false);
    expect(usageWriteReport).not.toHaveBeenCalled();
  });
});

describe("모아서 한 번 쓴다", () => {
  it("달마다 읽고 문서는 한 번만 쓴다", async () => {
    usageMonths.mockResolvedValue({ months: ["2026-08", "2026-07"] });
    await expect(writeUsageAnalysis(["cmd-a"])).resolves.toBe(true);
    expect(usageRead).toHaveBeenCalledTimes(2);
    expect(usageWriteReport).toHaveBeenCalledTimes(1);
  });

  /**
   * ⚠️ **달 목록은 최신이 앞이다.** 라벨은 `가장 오래된 ~ 가장 최근` 이어야 사람이
   * 읽는 순서와 맞는다. 뒤집히면 "2026-08 ~ 2026-07" 같은 거꾸로 된 기간이 문서에 박힌다.
   */
  it("여러 달이면 오래된 것부터 최근까지로 이름 붙인다", async () => {
    usageMonths.mockResolvedValue({ months: ["2026-08", "2026-07", "2026-06"] });
    await writeUsageAnalysis([]);
    const doc = usageWriteReport.mock.calls[0][0];
    expect(doc).toContain("2026-06 ~ 2026-08");
  });

  it("한 달이면 그 달 이름만", async () => {
    usageMonths.mockResolvedValue({ months: ["2026-08"] });
    await writeUsageAnalysis([]);
    // ⚠️ 제목 줄만 본다 — 본문에는 설명 속 `~` 가 따로 있다.
    const title = usageWriteReport.mock.calls[0][0].split("\n")[0];
    expect(title).toContain("2026-08");
    expect(title, "한 달인데 기간처럼 적었다").not.toContain("~");
  });
});

/**
 * 🔴 **어디서 터져도 앱은 살아야 한다.** 셋 다 실패할 수 있는 자리다 — 목록 읽기 ·
 * 로그 읽기 · 문서 쓰기. 하나라도 던지면 기동이 멈춘다.
 */
describe("실패해도 던지지 않는다", () => {
  const cases: [string, () => void][] = [
    ["달 목록을 못 읽음", () => usageMonths.mockRejectedValue(new Error("no dir"))],
    [
      "로그를 못 읽음",
      () => {
        usageMonths.mockResolvedValue({ months: ["2026-08"] });
        usageRead.mockRejectedValue(new Error("permission denied"));
      },
    ],
    [
      "문서를 못 씀",
      () => {
        usageMonths.mockResolvedValue({ months: ["2026-08"] });
        usageWriteReport.mockRejectedValue(new Error("read-only"));
      },
    ],
  ];

  for (const [name, arrange] of cases) {
    it(`${name} — false 를 내고 남긴다`, async () => {
      arrange();
      await expect(writeUsageAnalysis([])).resolves.toBe(false);
      expect(logWarn, "조용히 삼켰다 — 실패가 어디에도 안 남는다").toHaveBeenCalled();
    });
  }
});

describe("문서 이름", () => {
  /** ⚠️ 로그와 같은 폴더에 선다. 이름이 바뀌면 사용자가 찾던 파일이 사라진 것으로 보인다. */
  it("analysis.md 다", () => {
    expect(REPORT_NAME).toBe("analysis.md");
  });
});
