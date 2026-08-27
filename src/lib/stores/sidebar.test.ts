import { describe, it, expect } from "vitest";
import {
  VIEW_KEYS,
  defaultSidebarNav,
  migrateSidebarNav,
  type SidebarViewKey,
} from "./sidebar";

/**
 * 사이드바 단일 뷰 — **마이그레이션이 이 파일의 절반이다.**
 *
 * ⚠️ 저장된 상태를 잘못 읽으면 앱이 사용자가 보던 것과 **다른 화면으로 열린다.** 에러는
 * 없고, 사용자는 "설정이 날아갔다"로 읽는다. 3.0 은 아코디언 상태를 그대로 못 쓰므로
 * 이 변환이 반드시 있어야 한다.
 */

describe("기본값", () => {
  it("파일 트리로 연다", () => {
    expect(defaultSidebarNav().activeView).toBe("files");
  });

  /** 레일의 세로 순서가 이 배열이다 — 순서가 바뀌면 아이콘이 자리를 바꾼다. */
  it("뷰 여섯이 정해진 순서로 있다", () => {
    expect([...VIEW_KEYS]).toEqual([
      "files",
      "tags",
      "filters",
      "favorites",
      "table",
      "hygiene",
    ]);
  });
});

describe("마이그레이션", () => {
  it("새 상태는 그대로 읽는다", () => {
    expect(migrateSidebarNav({ activeView: "tags" }).activeView).toBe("tags");
  });

  /**
   * ⚠️ **열려 있던 첫 섹션**을 고른다. 아무거나 고르면 보던 화면과 다르게 열린다.
   * 순서는 `VIEW_KEYS` 기준 — 화면에서 위에 있던 것이 이긴다.
   */
  it("옛 아코디언에서 열려 있던 첫 섹션을 고른다", () => {
    const legacy = {
      sectionOpen: { files: false, tags: false, filters: true, favorites: true },
      sectionHeights: { files: 100, tags: null, filters: 200, favorites: null },
    };
    expect(migrateSidebarNav(legacy).activeView).toBe("filters");
  });

  it("전부 닫혀 있었으면 파일 트리", () => {
    const legacy = {
      sectionOpen: { files: false, tags: false, filters: false, favorites: false },
    };
    expect(migrateSidebarNav(legacy).activeView).toBe("files");
  });

  /** ⚠️ 높이는 뜻을 잃는다 — 뷰가 하나면 나눌 높이가 없다. 조용히 버리는 게 맞다. */
  it("옛 높이는 새 상태에 남지 않는다", () => {
    const out = migrateSidebarNav({
      sectionOpen: { tags: true },
      sectionHeights: { tags: 300 },
    });
    expect(Object.keys(out)).toEqual(["activeView"]);
  });

  it("모르는 뷰 이름은 기본값으로 떨어진다", () => {
    expect(migrateSidebarNav({ activeView: "없는뷰" }).activeView).toBe("files");
  });

  /** 저장값이 깨졌거나 없을 때 — 앱이 안 뜨면 안 된다. */
  it("쓰레기 입력에도 기본값을 낸다", () => {
    for (const bad of [null, undefined, 0, "", "문자열", [], { 뭐: 1 }]) {
      expect(migrateSidebarNav(bad).activeView, JSON.stringify(bad)).toBe("files");
    }
  });

  /**
   * ⚠️ 카나리아 — 옛 상태를 **읽기는 하는지**. 변환이 아무것도 못 읽고 늘 기본값을 내면
   * 위 단언들이 전부 통과하면서 마이그레이션은 없는 것이 된다.
   */
  it("옛 상태에서 기본값이 아닌 값을 실제로 뽑는다", () => {
    const picked = new Set<SidebarViewKey>();
    for (const k of ["tags", "filters", "favorites"] as const) {
      picked.add(migrateSidebarNav({ sectionOpen: { [k]: true } }).activeView);
    }
    expect(picked).toEqual(new Set(["tags", "filters", "favorites"]));
  });
});
