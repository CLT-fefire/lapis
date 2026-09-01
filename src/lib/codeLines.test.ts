import { describe, it, expect } from "vitest";
import { codeBlockLines, blankCodeBlocks } from "./codeLines";
import { findOpenTasks } from "./openTasks";
import { maskNonProse } from "./vaultAudit";

const F = "`".repeat(3);
const T = "~".repeat(3);
const tasks = (body: string) => findOpenTasks("/v/a.md", body).open.map((t) => t.text);

/**
 * **본문에서 어느 줄이 코드인가** — 주인 하나와 소비자 셋이 같은 답을 내는가.
 *
 * ## 🔴 왜 이 파일이 있나 (2026-08-30 실측)
 *
 * 같은 질문에 세 곳이 **다르게** 답하고 있었다:
 *
 * | 어디 | 놓친 것 |
 * |---|---|
 * | `linkRewrite.ts` (markdown-it) | 없음 — 다만 **비공개**였다 |
 * | `openTasks.ts` (줄 토글) | 들여쓴 코드블록 |
 * | `maskNonProse` (정규식) | `~~~` 펜스 · 들여쓴 코드블록 |
 *
 * ⚠️ 맞는 답이 이미 있었는데 **그 파일 밖으로 안 나갔다.** 노트 확장자 때와 같다.
 *
 * ⚠️ **조용하다.** 예시를 할 일로 세면 숫자가 늘 뿐 에러가 안 나고, 코드 안의 낱말을
 * "안 걸린 언급"으로 보고해도 마찬가지다. 감사가 오탐을 내면 목록 자체를 안 믿게 된다.
 */
describe("codeBlockLines — 주인", () => {
  it("백틱 펜스", () => {
    expect([...codeBlockLines(["앞", F, "코드", F, "뒤"].join("\n"))]).toEqual([1, 2, 3]);
  });

  it("물결 펜스", () => {
    expect(codeBlockLines(["앞", T, "코드", T, "뒤"].join("\n")).has(2)).toBe(true);
  });

  it("들여쓴 코드블록", () => {
    expect(codeBlockLines(["문단", "", "    코드"].join("\n")).has(2)).toBe(true);
  });

  /**
   * 🔴 **이게 정규식으로 못 하는 이유다.** 생김새가 위와 같은데 코드가 아니다 —
   * 리스트 안의 들여쓰기는 계속이지 코드블록이 아니다. 블록 파서만 이 둘을 가른다.
   */
  it("리스트 안의 들여쓰기는 코드가 아니다", () => {
    const body = ["- [ ] 부모", "    - [ ] 자식"].join("\n");
    expect(codeBlockLines(body).has(1)).toBe(false);
  });

  it("코드가 없으면 빈 집합", () => {
    expect(codeBlockLines("그냥 문단\n또 문단").size).toBe(0);
  });
});

describe("blankCodeBlocks — 길이 보존", () => {
  it("코드 줄을 공백으로 덮되 길이는 그대로", () => {
    const body = ["앞", F, "캐시 계약", F, "뒤"].join("\n");
    const out = blankCodeBlocks(body);
    expect(out).not.toContain("캐시 계약");
    // 🔴 길이가 변하면 줄 번호와 오프셋이 어긋나 엉뚱한 줄을 가리킨다.
    expect(out).toHaveLength(body.length);
    expect(out.split("\n")).toHaveLength(body.split("\n").length);
  });

  it("코드가 없으면 그대로", () => {
    expect(blankCodeBlocks("문단")).toBe("문단");
  });
});

describe("소비자 ① 미완 작업", () => {
  it("평범한 펜스 안은 안 센다", () => {
    expect(tasks([F + "md", "- [ ] 예시", F, "- [ ] 진짜"].join("\n"))).toEqual(["진짜"]);
  });

  /** 예전에 새던 자리. */
  it("들여쓴 코드블록 안도 안 센다", () => {
    expect(tasks(["본문", "", "    - [ ] 들여쓴 예시"].join("\n"))).toEqual([]);
  });

  /**
   * 🔴 **중첩 할 일이 죽지 않는다.** 위 케이스와 들여쓰기가 같아서, "4칸이면 코드"로
   * 고쳤다면 여기가 통째로 사라졌다. 고치면서 무엇을 깨뜨릴 뻔했는지를 고정한다.
   */
  it("중첩 할 일은 살아 있고 depth 를 유지한다", () => {
    const g = findOpenTasks("/v/a.md", ["- [ ] 부모", "    - [ ] 자식"].join("\n"));
    expect(g.open.map((t) => t.text)).toEqual(["부모", "자식"]);
    expect(g.open.map((t) => t.depth)).toEqual([0, 2]);
  });

  it("코드 안의 완료 표시도 안 센다 — 분모까지 틀어진다", () => {
    expect(findOpenTasks("/v/a.md", ["    - [x] 예시", "- [ ] 진짜"].join("\n")).done).toBe(0);
  });
});

describe("소비자 ② 안 걸린 언급의 마스킹", () => {
  it("백틱 펜스 안은 산문이 아니다", () => {
    expect(maskNonProse(["앞", F, "캐시 계약", F, "뒤"].join("\n"))).not.toContain("캐시 계약");
  });

  /** 예전에 새던 자리 — 정규식이 백틱만 봤다. */
  it("물결 펜스 안도 산문이 아니다", () => {
    expect(maskNonProse(["앞", T, "캐시 계약", T, "뒤"].join("\n"))).not.toContain("캐시 계약");
  });

  it("들여쓴 코드블록 안도 산문이 아니다", () => {
    expect(maskNonProse(["앞", "", "    캐시 계약", "", "뒤"].join("\n"))).not.toContain(
      "캐시 계약",
    );
  });

  /** 🔴 이 함수의 계약이다. 깨져도 예외가 안 나고 결과만 그럴듯하게 틀린다. */
  it("길이를 보존한다", () => {
    const body = ["앞", T, "캐시 계약", T, "뒤"].join("\n");
    expect(maskNonProse(body)).toHaveLength(body.length);
  });
});

describe("셋이 같은 답을 낸다", () => {
  const body = [
    "문단",
    T,
    "- [ ] 물결 펜스 안",
    T,
    "",
    "    - [ ] 들여쓴 코드 안",
    "",
    "- [ ] 진짜",
    "    - [ ] 진짜의 자식",
  ].join("\n");

  it("코드라 본 줄에는 할 일이 없다", () => {
    const code = codeBlockLines(body);
    for (const t of findOpenTasks("/v/a.md", body).open) {
      expect(code.has(t.line), `${t.line}번 줄은 코드인데 할 일로 셌다: ${t.text}`).toBe(false);
    }
  });

  it("남는 것은 진짜 둘뿐이다", () => {
    expect(tasks(body)).toEqual(["진짜", "진짜의 자식"]);
  });
});
