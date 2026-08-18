import { describe, it, expect } from "vitest";
import { m } from "$lib/paraglide/messages.js";
import {
  bannerDismissKey,
  shouldShowBanner,
  autoCommitMessage,
  formatCommitDate,
  diffLineClass,
} from "./git";

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
  // ⚠️ 문구는 로케일 의존(node 환경엔 navigator가 없어 baseLocale=en). 시각 포맷은
  // 로케일 중립이라 양쪽 공통 — 그래서 시각만 무조건 단정하고 문구는 로케일별로 본다.
  it("시각 포맷(0-패딩) 포함", () => {
    const msg = autoCommitMessage(new Date(2026, 0, 5, 9, 7)); // 2026-01-05 09:07
    expect(msg).toContain("2026-01-05 09:07");
    expect(msg).toContain("Lapis auto snapshot");
    expect(m.git_auto_commit_message({ timestamp: "x" }, { locale: "ko" })).toContain(
      "Lapis 자동 스냅샷",
    );
  });
});

describe("formatCommitDate", () => {
  it("epoch seconds → YYYY-MM-DD HH:mm, 0은 —", () => {
    const ts = Math.floor(new Date(2026, 0, 5, 9, 7).getTime() / 1000);
    expect(formatCommitDate(ts)).toBe("2026-01-05 09:07");
    expect(formatCommitDate(0)).toBe("—");
  });
});

describe("diffLineClass", () => {
  it("unified diff 줄 종류 분류", () => {
    expect(diffLineClass("+추가된 줄")).toBe("add");
    expect(diffLineClass("-삭제된 줄")).toBe("del");
    expect(diffLineClass("+++ b/note.md")).toBe("meta"); // +++ 는 add 아님
    expect(diffLineClass("--- a/note.md")).toBe("meta");
    expect(diffLineClass("@@ -1,3 +1,4 @@")).toBe("hunk");
    expect(diffLineClass("diff --git a/x b/x")).toBe("meta");
    expect(diffLineClass(" 변경 없는 줄")).toBe("ctx");
  });
});
