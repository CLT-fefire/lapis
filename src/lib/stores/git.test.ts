import { describe, it, expect } from "vitest";
import { bannerDismissKey, shouldShowBanner, autoCommitMessage } from "./git";

describe("shouldShowBanner", () => {
  it("repo 아니고 dismiss 안 했을 때만 노출", () => {
    expect(shouldShowBanner(false, false)).toBe(true);
    expect(shouldShowBanner(true, false)).toBe(false); // 이미 repo
    expect(shouldShowBanner(false, true)).toBe(false); // dismiss됨
    expect(shouldShowBanner(true, true)).toBe(false);
  });
});

describe("bannerDismissKey", () => {
  it("vault별 고유 키 + 경로 포함", () => {
    expect(bannerDismissKey("/a")).not.toBe(bannerDismissKey("/b"));
    expect(bannerDismissKey("/Users/x/vault")).toContain("/Users/x/vault");
  });
});

describe("autoCommitMessage", () => {
  it("시각 포맷(0-패딩) 포함", () => {
    const msg = autoCommitMessage(new Date(2026, 0, 5, 9, 7)); // 2026-01-05 09:07
    expect(msg).toContain("Lapis 자동 스냅샷");
    expect(msg).toContain("2026-01-05 09:07");
  });
});
