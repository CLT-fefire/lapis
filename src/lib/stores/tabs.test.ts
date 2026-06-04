import { describe, it, expect } from "vitest";
import {
  addTabEntry,
  removeTabEntry,
  tabPathForShortcut,
  readVaultTabs,
  upsertVaultTabs,
  reorderTabs,
  closeOthers,
  keepUpTo,
  type TabsMap,
} from "./tabs";

describe("addTabEntry", () => {
  it("새 path를 끝에 추가", () => {
    expect(addTabEntry(["a", "b"], "c")).toEqual(["a", "b", "c"]);
  });

  it("이미 있으면 그대로(중복 안 함)", () => {
    const tabs = ["a", "b"];
    expect(addTabEntry(tabs, "b")).toBe(tabs);
  });

  it("빈 path는 무시", () => {
    const tabs = ["a"];
    expect(addTabEntry(tabs, "")).toBe(tabs);
  });
});

describe("removeTabEntry", () => {
  it("활성 탭 닫기 → 오른쪽 탭 활성화", () => {
    const r = removeTabEntry(["a", "b", "c"], "b", "b");
    expect(r).toEqual({ tabs: ["a", "c"], nextActive: "c" });
  });

  it("마지막(활성) 탭 닫기 → 왼쪽 탭 활성화", () => {
    const r = removeTabEntry(["a", "b", "c"], "c", "c");
    expect(r).toEqual({ tabs: ["a", "b"], nextActive: "b" });
  });

  it("비활성 탭 닫기 → 활성 그대로", () => {
    const r = removeTabEntry(["a", "b", "c"], "a", "c");
    expect(r).toEqual({ tabs: ["b", "c"], nextActive: "c" });
  });

  it("마지막 한 개(활성) 닫기 → 빈 목록 + null", () => {
    const r = removeTabEntry(["a"], "a", "a");
    expect(r).toEqual({ tabs: [], nextActive: null });
  });

  it("목록에 없는 path → 변화 없음", () => {
    const tabs = ["a", "b"];
    const r = removeTabEntry(tabs, "z", "a");
    expect(r).toEqual({ tabs, nextActive: "a" });
  });

  it("첫 번째(활성) 탭 닫기 → 새 첫 탭 활성화", () => {
    const r = removeTabEntry(["a", "b", "c"], "a", "a");
    expect(r).toEqual({ tabs: ["b", "c"], nextActive: "b" });
  });
});

describe("tabPathForShortcut", () => {
  const tabs = ["a", "b", "c"];

  it("1~9번째 탭(1-based)", () => {
    expect(tabPathForShortcut(tabs, 1)).toBe("a");
    expect(tabPathForShortcut(tabs, 3)).toBe("c");
    const nine = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
    expect(tabPathForShortcut(nine, 9)).toBe("9");
  });

  it("탭 수 초과 index는 null (9번째 탭이 없으면 null)", () => {
    expect(tabPathForShortcut(tabs, 5)).toBeNull();
    expect(tabPathForShortcut(tabs, 9)).toBeNull();
  });

  it("빈 목록은 null", () => {
    expect(tabPathForShortcut([], 1)).toBeNull();
    expect(tabPathForShortcut([], 9)).toBeNull();
  });
});

describe("readVaultTabs / upsertVaultTabs", () => {
  it("빈 맵에서 read → 기본 빈 상태", () => {
    expect(readVaultTabs({}, "/vault/a")).toEqual({ tabs: [], active: null });
  });

  it("upsert 후 read 왕복", () => {
    const map = upsertVaultTabs({}, "/vault/a", ["x", "y"], "y");
    expect(readVaultTabs(map, "/vault/a")).toEqual({ tabs: ["x", "y"], active: "y" });
  });

  it("다른 vault는 격리(서로 영향 없음)", () => {
    let map: TabsMap = upsertVaultTabs({}, "/vault/a", ["a1"], "a1");
    map = upsertVaultTabs(map, "/vault/b", ["b1", "b2"], "b2");
    expect(readVaultTabs(map, "/vault/a")).toEqual({ tabs: ["a1"], active: "a1" });
    expect(readVaultTabs(map, "/vault/b")).toEqual({ tabs: ["b1", "b2"], active: "b2" });
  });

  it("같은 vault upsert는 덮어씀", () => {
    let map = upsertVaultTabs({}, "/vault/a", ["x"], "x");
    map = upsertVaultTabs(map, "/vault/a", ["y", "z"], null);
    expect(readVaultTabs(map, "/vault/a")).toEqual({ tabs: ["y", "z"], active: null });
  });
});

describe("reorderTabs", () => {
  it("앞 → 뒤 이동", () => {
    expect(reorderTabs(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  it("뒤 → 앞 이동", () => {
    expect(reorderTabs(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("인접 교환", () => {
    expect(reorderTabs(["a", "b", "c"], 1, 2)).toEqual(["a", "c", "b"]);
  });

  it("동일 위치는 그대로", () => {
    const t = ["a", "b", "c"];
    expect(reorderTabs(t, 1, 1)).toBe(t);
  });

  it("범위 밖은 그대로", () => {
    const t = ["a", "b"];
    expect(reorderTabs(t, 0, 5)).toBe(t);
    expect(reorderTabs(t, -1, 0)).toBe(t);
  });
});

describe("closeOthers", () => {
  it("path만 남김", () => {
    expect(closeOthers(["a", "b", "c"], "b")).toEqual(["b"]);
  });
  it("path 없으면 그대로", () => {
    const t = ["a", "b"];
    expect(closeOthers(t, "z")).toBe(t);
  });
});

describe("keepUpTo", () => {
  it("중간 path까지 유지(오른쪽 제거)", () => {
    expect(keepUpTo(["a", "b", "c", "d"], "b")).toEqual(["a", "b"]);
  });
  it("마지막 path면 변화 없음(오른쪽 없음)", () => {
    expect(keepUpTo(["a", "b", "c"], "c")).toEqual(["a", "b", "c"]);
  });
  it("path 없으면 그대로", () => {
    const t = ["a", "b"];
    expect(keepUpTo(t, "z")).toBe(t);
  });
});
