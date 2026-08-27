import { describe, it, expect } from "vitest";
import {
  RECENT_VAULTS_MAX,
  pushRecentVault,
  normalizeRecentVaults,
} from "./recentVaults";

/**
 * 최근 vault 목록.
 *
 * ⚠️ 여기서 조용히 틀리는 방법은 **중복**이다. 같은 vault 를 열 때마다 한 칸씩 쌓이면
 * 다섯 칸이 전부 같은 경로가 되고, 목록은 그려지는데 아무 데도 못 간다.
 */

describe("pushRecentVault", () => {
  it("새 경로가 맨 앞", () => {
    expect(pushRecentVault(["a", "b"], "c")).toEqual(["c", "a", "b"]);
  });

  it("이미 있던 경로는 앞으로 올라올 뿐 늘지 않는다", () => {
    expect(pushRecentVault(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });

  it("상한을 넘으면 오래된 것부터 떨어진다", () => {
    const list = ["1", "2", "3", "4", "5"];
    expect(pushRecentVault(list, "6")).toEqual(["6", "1", "2", "3", "4"]);
    expect(pushRecentVault(list, "6")).toHaveLength(RECENT_VAULTS_MAX);
  });

  /** 다이얼로그가 취소되면 빈 문자열이 올 수 있다 — 빈 칸을 목록에 남기지 않는다. */
  it("빈 경로는 안 넣는다", () => {
    expect(pushRecentVault(["a"], "")).toEqual(["a"]);
    expect(pushRecentVault(["a"], "   ")).toEqual(["a"]);
  });

  it("원본을 건드리지 않는다", () => {
    const list = ["a"];
    pushRecentVault(list, "b");
    expect(list).toEqual(["a"]);
  });
});

describe("normalizeRecentVaults", () => {
  it("문자열 배열을 그대로 읽는다", () => {
    expect(normalizeRecentVaults(["a", "b"])).toEqual(["a", "b"]);
  });

  it("배열이 아니면 빈 목록", () => {
    for (const bad of [null, undefined, "a", 3, { 0: "a" }]) {
      expect(normalizeRecentVaults(bad), JSON.stringify(bad)).toEqual([]);
    }
  });

  /** 옛 저장값이 어떤 이유로 중복을 품고 있어도 읽는 쪽에서 정리한다. */
  it("중복과 비문자열을 걸러 낸다", () => {
    expect(normalizeRecentVaults(["a", "a", 1, null, "b", "  "])).toEqual(["a", "b"]);
  });

  it("상한까지만 읽는다", () => {
    const many = Array.from({ length: 12 }, (_, i) => `v${i}`);
    expect(normalizeRecentVaults(many)).toHaveLength(RECENT_VAULTS_MAX);
  });
});
