import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildUsageJsonl, suggestUsageFileName } from "./usageExport";

/**
 * 원본 내보내기.
 *
 * ## 🔴 지키는 것은 하나 — **디스크의 진실과 같을 것**
 *
 * 파싱해서 다시 쓰면 못 읽은 줄이 조용히 사라진다. 분석하는 쪽은 그 사실을 알 방법이
 * 없고, "이벤트가 이만큼 있었다"는 결론이 그만큼 틀린다.
 */

describe("buildUsageJsonl", () => {
  it("줄을 그대로 잇는다", () => {
    const out = buildUsageJsonl([{ month: "2026-08", lines: ['{"a":1}', '{"b":2}'] }]);
    expect(out).toBe('{"a":1}\n{"b":2}\n');
  });

  /** 🔴 못 읽는 줄도 **그대로** 나와야 한다. 거르면 파일이 디스크와 달라진다. */
  it("깨진 줄을 거르지 않는다", () => {
    const out = buildUsageJsonl([
      { month: "2026-08", lines: ['{"ok":1}', "이건 JSON 이 아니다", '{"k":"미래종류"}'] },
    ]);
    expect(out).toContain("이건 JSON 이 아니다");
    expect(out).toContain('{"k":"미래종류"}');
    expect(out.trimEnd().split("\n")).toHaveLength(3);
  });

  /** ⚠️ 오래된 달이 먼저 — `usage_months` 는 내림차순으로 준다. */
  it("달을 오름차순으로 잇는다", () => {
    const out = buildUsageJsonl([
      { month: "2026-09", lines: ["나중"] },
      { month: "2026-07", lines: ["먼저"] },
      { month: "2026-08", lines: ["가운데"] },
    ]);
    expect(out).toBe("먼저\n가운데\n나중\n");
  });

  /** 줄 단위 도구가 마지막 줄을 세려면 끝 개행이 있어야 한다. */
  it("끝에 개행이 하나 붙는다", () => {
    expect(buildUsageJsonl([{ month: "2026-08", lines: ["x"] }])).toBe("x\n");
  });

  it("빈 입력은 빈 문자열 — 개행만 있는 파일을 만들지 않는다", () => {
    expect(buildUsageJsonl([])).toBe("");
    expect(buildUsageJsonl([{ month: "2026-08", lines: [] }])).toBe("");
  });

  it("입력 배열을 안 건드린다", () => {
    const months = [
      { month: "2026-09", lines: ["b"] },
      { month: "2026-07", lines: ["a"] },
    ];
    buildUsageJsonl(months);
    expect(months.map((m) => m.month)).toEqual(["2026-09", "2026-07"]);
  });
});

describe("suggestUsageFileName", () => {
  it("한 달이면 그 달", () => {
    expect(suggestUsageFileName(["2026-08"], "jsonl")).toBe("lapis-usage-2026-08.jsonl");
  });

  it("여러 달이면 범위", () => {
    expect(suggestUsageFileName(["2026-09", "2026-07"], "md")).toBe(
      "lapis-usage-2026-07_2026-09.md",
    );
  });

  it("달이 없어도 이름을 낸다", () => {
    expect(suggestUsageFileName([], "jsonl")).toBe("lapis-usage.jsonl");
  });
});

/**
 * ⚠️ **호출부가 원본을 재직렬화하지 않는가.** 순수 함수가 초록이어도 화면이
 * `serialize` 로 다시 쓰면 못 읽은 줄이 사라진다 — 에러 없이.
 */
describe("배선", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./SettingsModal.svelte", import.meta.url)),
    "utf-8",
  );

  it("설정 화면이 이 함수를 쓴다", () => {
    expect(src).toMatch(/buildUsageJsonl\(/);
  });

  it("원본 경로에서 파싱해 다시 쓰지 않는다", () => {
    // `parseLine` 이나 `serialize` 가 내보내기 경로에 보이면 원본이 아니게 된다.
    expect(src, "내보내기가 원본을 재직렬화한다").not.toMatch(/serialize\(/);
  });
});
