import { describe, it, expect } from "vitest";
import { togglePinEntry, removePinEntry } from "./pins";

describe("togglePinEntry", () => {
  it("없으면 맨 앞에 추가", () => {
    expect(togglePinEntry(["b", "c"], "a")).toEqual(["a", "b", "c"]);
  });

  it("있으면 제거", () => {
    expect(togglePinEntry(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("빈 목록에 추가", () => {
    expect(togglePinEntry([], "a")).toEqual(["a"]);
  });

  it("마지막 핀 제거 → 빈 목록", () => {
    expect(togglePinEntry(["a"], "a")).toEqual([]);
  });

  it("빈 path는 무시", () => {
    const pins = ["a"];
    expect(togglePinEntry(pins, "")).toBe(pins);
  });
});

describe("removePinEntry", () => {
  it("있으면 제거", () => {
    expect(removePinEntry(["a", "b"], "a")).toEqual(["b"]);
  });

  it("없으면 그대로", () => {
    const pins = ["a", "b"];
    expect(removePinEntry(pins, "z")).toBe(pins);
  });
});
