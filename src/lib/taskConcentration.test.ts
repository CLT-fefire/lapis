import { describe, it, expect } from "vitest";
import { taskConcentration } from "./openTasks";
import type { OpenTaskGroup } from "./openTasks";

/**
 * 🔴 **맨숫자 하나는 어디에 몰렸는지를 감춘다.**
 *
 * ## 실측
 *
 * 실제 vault 에서 `lapis_stats` 가 `tasks: { open: 90, done: 30 }` 을 냈다. 그런데
 * `tasks audit` 을 열어 보니 **89건 중 67건이 한 파일**이었다 — 수동 테스트 체크리스트다.
 * 즉 "할 일 90개"의 **75%가 실제 할 일이 아니었다.**
 *
 * MCP 로 물어본 쪽은 그 숫자를 그대로 받는다. 틀린 값은 아니지만, 답으로 쓰면 틀린다.
 *
 * ## ⚠️ 설정을 새로 만들지 않는다
 *
 * 고아 노트 때 같은 갈림길이 있었고 그때 이렇게 정했다 — "**나가는 링크 수를 같이
 * 보고한다. 프론트매터 표식도 `exclude` 설정도 새로 만들지 않는다.** 두 숫자를 나란히
 * 보여주면 사람이 바로 구분한다."
 *
 * 여기서도 같다. 무엇을 빼야 할지 앱이 정하지 않는다. **어디에 몰렸는지**를 같이 낸다.
 */

const G = (path: string, open: number, done = 0): OpenTaskGroup => ({
  path,
  // ⚠️ 실제 `OpenTask` 모양을 그대로 쓴다. 줄여 만들면 vitest 는 통과하고
  //    `svelte-check` 만 운다 — 실제로 그렇게 걸렸다.
  open: Array.from({ length: open }, (_, i) => ({
    path,
    line: i + 1,
    text: `t${i}`,
    depth: 0,
  })),
  done,
});

describe("어디에 몰렸나", () => {
  it("가장 많은 노트와 그 비중을 낸다", () => {
    const c = taskConcentration([G("a.md", 67), G("b.md", 12), G("c.md", 10)]);
    expect(c.total).toBe(89);
    expect(c.top?.path).toBe("a.md");
    expect(c.top?.open).toBe(67);
    // 67/89 = 0.752…
    expect(c.top?.share).toBeCloseTo(0.7528, 3);
  });

  /** ⚠️ 몇 개 노트에 흩어져 있는지도 알아야 "몰렸다"를 판단할 수 있다. */
  it("작업이 있는 노트 수를 센다", () => {
    const c = taskConcentration([G("a.md", 1), G("b.md", 1), G("c.md", 0)]);
    expect(c.notes, "미완이 0인 노트를 셌다").toBe(2);
  });

  it("없으면 top 이 null", () => {
    expect(taskConcentration([]).top).toBeNull();
    expect(taskConcentration([G("a.md", 0, 3)]).top).toBeNull();
  });

  /** 고르게 퍼져 있으면 비중이 낮다 — 그 자체가 "안 몰렸다"는 신호다. */
  it("고르면 비중이 낮다", () => {
    const c = taskConcentration([G("a.md", 3), G("b.md", 3), G("c.md", 3), G("d.md", 3)]);
    expect(c.top?.share).toBeCloseTo(0.25, 5);
  });

  /**
   * ⚠️ **0 으로 나누지 않는다.** 완료만 있고 미완이 0이면 `share` 를 계산할 분모가 없다.
   * `NaN` 이 나가면 JSON 에서 `null` 이 되어 소비자가 "몰림 없음"으로 읽는다.
   */
  it("미완이 0이어도 NaN 을 안 낸다", () => {
    const c = taskConcentration([G("a.md", 0, 5)]);
    expect(c.total).toBe(0);
    expect(c.top).toBeNull();
  });

  /** 같은 수면 경로 순으로 — 같은 입력에 같은 답이 나와야 한다. */
  it("동점은 경로 순", () => {
    const c = taskConcentration([G("b.md", 5), G("a.md", 5)]);
    expect(c.top?.path).toBe("a.md");
  });
});
