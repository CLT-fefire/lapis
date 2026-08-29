import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  comparePath,
  openCompare,
  closeCompare,
  toggleCompare,
  closeIfSame,
} from "./compare";

/**
 * 나란히 보기 — 한 창에서 두 노트를 동시에 읽는다.
 *
 * ## 🔴 왜 "읽기 전용"인가
 *
 * 지금은 두 노트를 비교하려면 `⌘⇧T` 로 **창을 따로** 띄워야 한다. 모니터가 하나면 불편하다.
 *
 * 그런데 본문 상태가 전부 싱글턴이다 — `currentNotePath` · `renderedArticleEl` ·
 * `mainPane`(읽기/편집) · 문서 내 검색 · 읽던 자리. **완전한 두 번째 작업 공간**을 만들려면
 * 그 전부를 창(pane)별로 쪼개야 하는데, 그건 2,400줄짜리 파일의 구조 개편이고 이 패스에
 * 담을 크기가 아니다.
 *
 * 그래서 옆칸은 **읽기만** 한다 — 탭도 편집기도 문서 내 검색도 없다. 값의 8할은 거기 있다:
 * "A 를 읽으면서 B 를 띄워 두기".
 *
 * ⚠️ 이 판단을 코드에 적어 두는 이유는, 안 적으면 다음 사람이 "왜 반쪽이지"를 다시
 * 조사하기 때문이다.
 */

beforeEach(() => closeCompare());

describe("열고 닫기", () => {
  it("기본은 닫힘", () => {
    expect(get(comparePath)).toBeNull();
  });

  it("열면 그 경로가 담긴다", () => {
    openCompare("/v/a.md");
    expect(get(comparePath)).toBe("/v/a.md");
  });

  it("닫으면 비워진다", () => {
    openCompare("/v/a.md");
    closeCompare();
    expect(get(comparePath)).toBeNull();
  });

  /** ⚠️ 빈 경로로 열면 빈 칸이 생긴다 — 열지 않는 것과 구별이 안 된다. */
  it("빈 경로는 안 연다", () => {
    openCompare("");
    expect(get(comparePath)).toBeNull();
  });
});

describe("토글", () => {
  it("닫혀 있으면 연다", () => {
    toggleCompare("/v/a.md");
    expect(get(comparePath)).toBe("/v/a.md");
  });

  it("같은 노트면 닫는다", () => {
    openCompare("/v/a.md");
    toggleCompare("/v/a.md");
    expect(get(comparePath)).toBeNull();
  });

  /**
   * 🔴 **다른 노트면 바꿔 단다.** 닫아 버리면 "B 를 보다가 C 로"가 두 번 눌러야 하는 일이
   * 되고, 사람은 그걸 고장으로 읽는다.
   */
  it("다른 노트면 갈아 끼운다", () => {
    openCompare("/v/a.md");
    toggleCompare("/v/b.md");
    expect(get(comparePath)).toBe("/v/b.md");
  });
});

/**
 * ⚠️ **같은 노트를 양쪽에 띄우지 않는다.** 두 칸이 같은 것을 그리면 옆칸이 아무것도
 * 더해 주지 않으면서 자리만 반을 먹는다.
 */
describe("본문과 같은 노트", () => {
  it("본문과 같으면 안 연다", () => {
    openCompare("/v/a.md", "/v/a.md");
    expect(get(comparePath)).toBeNull();
  });

  it("본문과 다르면 연다", () => {
    openCompare("/v/b.md", "/v/a.md");
    expect(get(comparePath)).toBe("/v/b.md");
  });

  /**
   * 🔴 **본문이 옆칸과 같은 노트로 가면 옆칸을 닫는다.**
   *
   * 안 그러면 같은 문서가 나란히 두 벌 뜬다. 링크를 눌러 옮겨 다니다 보면 실제로 걸린다.
   */
  it("본문이 옆칸을 따라오면 닫는다", () => {
    openCompare("/v/b.md", "/v/a.md");
    closeIfSame("/v/b.md");
    expect(get(comparePath)).toBeNull();
  });

  it("다른 곳으로 가면 그대로 둔다", () => {
    openCompare("/v/b.md", "/v/a.md");
    closeIfSame("/v/c.md");
    expect(get(comparePath)).toBe("/v/b.md");
  });
});
