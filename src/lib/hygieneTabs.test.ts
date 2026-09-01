import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { HYGIENE_TABS } from "./hygieneTabs";
import { COMMAND_IDS } from "./commandIds";

/**
 * 진단 화면의 **탭 목록에 주인이 하나인가**, 그리고 팔레트가 전부에 닿는가.
 *
 * ## 🔴 왜 (2026-08-30 실측)
 *
 * 같은 목록이 **세 곳에 다르게** 있었다:
 *
 * | 어디 | 개수 |
 * |---|---|
 * | `VaultHygieneModal.svelte` 의 `type Tab` | **9** |
 * | `brokenLinks.ts` 의 `HygieneTab` | **7** (`decay`·`stale` 빠짐) |
 * | `commands.ts` 의 팔레트 목록 | **5** |
 *
 * ⚠️ `HygieneTab` 주석은 *"모달과 팔레트가 **공유한다**"* 고 적어 뒀는데 모달은 자기
 * 유니온을 따로 선언하고 있었다. **공유한다고 적힌 것이 안 공유됐다.**
 *
 * 🔴 그리고 `commands.ts` 의 주석이 이 일을 예언하고 있었다 —
 * *"감사가 다섯이 되고 나서 나머지 넷에 직행할 길이 없었다."* 같은 일이 또 났고,
 * 이유도 같다: **손으로 유지하는 목록.**
 *
 * `COMMAND_IDS` 가 같은 문제를 이미 양방향으로 막아 뒀다. 여기도 그렇게 한다.
 */

const SRC = (rel: string) => readFileSync(`src/lib/${rel}`, "utf8");

describe("탭 목록의 주인", () => {
  /** 가드가 빈 것을 보고 통과하지 않게. */
  it("목록이 비어 있지 않고 중복이 없다", () => {
    expect(HYGIENE_TABS.length).toBeGreaterThan(5);
    expect(new Set(HYGIENE_TABS).size).toBe(HYGIENE_TABS.length);
  });

  /**
   * ⚠️ 모달이 자기 유니온을 다시 선언하면 여기서 막는다. 타입이 아니라 **소스 글자**를
   * 보는 이유는, 유니온을 따로 선언해도 타입 검사는 안 울기 때문이다 — 실제로 그랬다.
   */
  it("모달이 탭 이름을 다시 나열하지 않는다", () => {
    const src = SRC("VaultHygieneModal.svelte");
    // ⚠️ `type Tab = HygieneTab` 같은 **별칭은 사본이 아니다.** 막을 것은 나열이다 —
    //    유니온을 다시 적으면 목록이 둘이 되고, 그게 실제로 벌어진 일이다.
    for (const tab of HYGIENE_TABS) {
      expect(src, `모달이 "${tab}" 을 유니온 항목으로 다시 적었다`).not.toContain(`| "${tab}"`);
    }
    expect(src).toContain("hygieneTabs");
  });

  /** 🔴 이게 이 파일의 요점 — 탭이 늘어도 팔레트가 따라오게. */
  it("모든 탭에 팔레트 명령이 있다", () => {
    for (const tab of HYGIENE_TABS) {
      const id = tab === "broken" ? "broken-links" : `audit-${tab}`;
      expect(COMMAND_IDS, `${tab} 탭에 직행할 명령이 없다`).toContain(id);
    }
  });

  /** 반대 방향 — 없는 탭을 가리키는 명령이 남아 있으면 죽은 항목이다. */
  it("팔레트의 audit 명령은 전부 실재하는 탭을 가리킨다", () => {
    const tabs = new Set<string>(HYGIENE_TABS);
    for (const id of COMMAND_IDS) {
      if (!id.startsWith("audit-")) continue;
      expect(tabs, `${id} 가 없는 탭을 가리킨다`).toContain(id.slice("audit-".length));
    }
  });
});
