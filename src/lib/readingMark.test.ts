import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readingMarkFor } from "./readingMark";

/**
 * 최근 목록이 **어디까지 읽었는지**를 말한다.
 *
 * ## 🔴 목록을 하나 더 만들지 않는다
 *
 * "최근 읽은 노트"를 새로 만들려다 보니 **이미 있었다** — `stores/recent.ts` 가 LRU 30
 * 으로 최근 **연** 노트를 들고 있고 `FavoritesPanel` 과 팔레트가 그걸 그린다.
 *
 * 비슷한 목록을 하나 더 두면 이 저장소가 가장 자주 겪은 결함이 된다 — 두 벌은 반드시
 * 갈린다. `palette.ts` 의 주석이 이미 같은 말을 한다("최근 연"과 "최근 바뀐"을 한 그룹에
 * 섞지 말 것).
 *
 * 진짜 빈 곳은 다른 데 있었다: **그 목록이 어느 것을 실제로 읽었는지 말하지 않는다.**
 * `readingPos` 가 자리를 이미 알고 있는데 패널이 안 본다(`FavoritesPanel` 의
 * `readingPos` 참조 0건).
 *
 * ## ⚠️ 퍼센트를 말하지 않는다
 *
 * `ReadingPos` 는 `scroll`(px)과 `line` 만 안다. **문서 전체 길이를 모른다.** 퍼센트를
 * 내려면 그걸 어림해야 하고, 어림한 진도는 틀려도 티가 안 난다 — 사람은 숫자를 믿는다.
 * 그래서 "읽던 자리가 있다/없다"만 말한다. 아는 것만 말한다.
 */

describe("읽던 자리 표식", () => {
  it("자리가 없으면 표식도 없다", () => {
    expect(readingMarkFor(null)).toBeNull();
  });

  it("스크롤 자리가 있으면 표식이 있다", () => {
    expect(readingMarkFor({ scroll: 1200 })).toEqual({ kind: "preview" });
  });

  /** 편집기에서 보던 자리는 **줄 번호**를 안다 — 그건 말할 수 있다. */
  it("줄을 알면 줄을 말한다", () => {
    expect(readingMarkFor({ scroll: 0, line: 42 })).toEqual({ kind: "editor", line: 42 });
  });

  /**
   * ⚠️ 편집기 줄이 우선이다. 둘 다 있으면 **더 구체적인 쪽**을 말한다 —
   * "1200px" 보다 "42줄"이 사람에게 뜻이 있다.
   */
  it("둘 다 있으면 줄을 말한다", () => {
    expect(readingMarkFor({ scroll: 900, line: 7 })).toEqual({ kind: "editor", line: 7 });
  });

  /**
   * 🔴 **맨 위는 자리가 아니다.** `readingPos` 는 맨 위를 아예 저장하지 않지만
   * (`rememberPos` 가 지운다), 낡은 저장분이 들어올 수 있다. 표식이 전부에 붙으면
   * 아무것도 구별해 주지 않는다.
   */
  it("맨 위는 표식이 없다", () => {
    expect(readingMarkFor({ scroll: 0 })).toBeNull();
    expect(readingMarkFor({ scroll: -5 })).toBeNull();
  });

  /** ⚠️ 1줄은 맨 위다 — 편집기를 열기만 한 것과 구별이 안 된다. */
  it("1줄은 표식이 없다", () => {
    expect(readingMarkFor({ scroll: 0, line: 1 })).toBeNull();
  });
});

/**
 * ⚠️ 순수 함수만 검사하면 아무도 안 불러도 초록이다.
 */
describe("배선", () => {
  const panel = readFileSync(
    fileURLToPath(new URL("./FavoritesPanel.svelte", import.meta.url)),
    "utf-8",
  );

  it("패널이 표식을 쓴다", () => {
    expect(panel).toMatch(/readingMarkFor/);
    expect(panel).toMatch(/posFor/);
  });

  /** ⚠️ 핀이 아니라 **최근** 쪽이다 — 핀은 "읽던 것"이 아니라 "보관한 것"이다. */
  it("최근 목록에 붙는다", () => {
    const at = panel.indexOf("fav_recent_title");
    expect(at).toBeGreaterThan(-1);
    expect(panel.slice(at), "최근 절 뒤에 표식이 없다").toMatch(/readingMarkFor|mark/);
  });
});
