import { describe, it, expect } from "vitest";
import { addTabEntry, removeTabEntry } from "./tabs";

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
