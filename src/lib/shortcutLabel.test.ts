import { describe, it, expect } from "vitest";
import { formatShortcut, localizeShortcutsInMarkdown } from "./shortcutLabel";

describe("formatShortcut — mac", () => {
  it("원본을 그대로 둔다", () => {
    expect(formatShortcut("⌘N", true)).toBe("⌘N");
    expect(formatShortcut("⌘⇧B", true)).toBe("⌘⇧B");
    expect(formatShortcut("F2", true)).toBe("F2");
  });
});

describe("formatShortcut — windows", () => {
  it("단일 modifier", () => {
    expect(formatShortcut("⌘N", false)).toBe("Ctrl+N");
    expect(formatShortcut("⌘B", false)).toBe("Ctrl+B");
    expect(formatShortcut("⌘E", false)).toBe("Ctrl+E");
  });

  it("⇧ 조합", () => {
    expect(formatShortcut("⌘⇧B", false)).toBe("Ctrl+Shift+B");
    expect(formatShortcut("⌘⇧T", false)).toBe("Ctrl+Shift+T");
    expect(formatShortcut("⌘⇧C", false)).toBe("Ctrl+Shift+C");
  });

  it("⌥ 조합 — Windows 관례 순서(Ctrl→Alt→Shift)로 재정렬", () => {
    expect(formatShortcut("⌘⌥B", false)).toBe("Ctrl+Alt+B");
    expect(formatShortcut("⌥⌘B", false)).toBe("Ctrl+Alt+B");
    expect(formatShortcut("⇧⌥⌘K", false)).toBe("Ctrl+Alt+Shift+K");
  });

  it("기호 키 이름을 풀어 쓴다", () => {
    expect(formatShortcut("⌘⌫", false)).toBe("Ctrl+Backspace");
    expect(formatShortcut("⌘⌦", false)).toBe("Ctrl+Delete");
  });

  it("modifier 없는 키는 그대로", () => {
    expect(formatShortcut("F2", false)).toBe("F2");
  });

  it("⌘와 ⌃는 둘 다 Ctrl이라 하나로 접힌다", () => {
    // Mac ⌘⌃← 는 Windows에 대응이 없다. Ctrl+Ctrl+← 같은 표기를 내지 않는 것이 요점.
    expect(formatShortcut("⌘⌃←", false)).toBe("Ctrl+←");
  });

  it("숫자 키", () => {
    expect(formatShortcut("⌘1", false)).toBe("Ctrl+1");
  });
});

describe("localizeShortcutsInMarkdown", () => {
  it("mac이면 원본 그대로", () => {
    expect(localizeShortcutsInMarkdown("| `⌘K` | 팔레트 |", true)).toBe("| `⌘K` | 팔레트 |");
  });

  it("백틱 안의 단축키를 치환한다", () => {
    expect(localizeShortcutsInMarkdown("| `⌘K` | 팔레트 |", false)).toBe("| `Ctrl+K` | 팔레트 |");
    expect(localizeShortcutsInMarkdown("`⌘⇧F`로 검색", false)).toBe("`Ctrl+Shift+F`로 검색");
  });

  it("한 줄에 여러 개", () => {
    expect(localizeShortcutsInMarkdown("`⌘1`–`⌘9`", false)).toBe("`Ctrl+1`–`Ctrl+9`");
  });

  it("백틱 밖 산문은 건드리지 않는다", () => {
    // 문장 속 ⌘ 언급까지 바꾸면 문안이 깨진다.
    const md = "Mac에서는 ⌘ 키를 쓴다.";
    expect(localizeShortcutsInMarkdown(md, false)).toBe(md);
  });

  it("modifier 없는 백틱 스팬은 그대로", () => {
    expect(localizeShortcutsInMarkdown("`[[Note name]]`", false)).toBe("`[[Note name]]`");
    expect(localizeShortcutsInMarkdown("`F2`", false)).toBe("`F2`");
  });

  it("줄이 다르면 백틱이 짝지어지지 않는다", () => {
    // 회귀 방지 — 줄바꿈을 허용하면 본문 한 덩어리가 통째로 먹힌다.
    const md = "여는 백틱 `⌘K` 끝\n다른 줄 `일반코드`";
    expect(localizeShortcutsInMarkdown(md, false)).toBe("여는 백틱 `Ctrl+K` 끝\n다른 줄 `일반코드`");
  });
});
