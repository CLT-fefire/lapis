import { describe, it, expect } from "vitest";
import { resolveShortcut, type KeyChord, type ShortcutId } from "./keymap";

/**
 * 단축키는 자주 바뀐다(2026-08-10 하루에 6건: ⌘E·⌘T 추가, ⌘⇧T 용도 변경,
 * ⌘,/⌘. 추가, ⌘G 제거, ⌘⇧T 기존 기능 제거). 그런데 테스트가 0건이었다 —
 * 매칭 조건이 효과와 한 줄에 붙어 있어 조건만 검증할 방법이 없었기 때문이다.
 *
 * 여기서 지키는 것은 두 가지다: **어떤 키가 어떤 id로 가는가**와 **우선순위**.
 */

function chord(partial: Partial<KeyChord> & { key: string }): KeyChord {
  return {
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...partial,
  };
}

const idOf = (c: KeyChord, inEditing = false): ShortcutId | null =>
  resolveShortcut(c, { inEditing })?.id ?? null;

describe("resolveShortcut — 기본 매핑", () => {
  const cases: Array<[string, KeyChord, ShortcutId]> = [
    ["⌘K", chord({ key: "k" }), "palette"],
    ["⌘P", chord({ key: "p" }), "quick-open"],
    ["⌘T", chord({ key: "t" }), "new-tab"],
    ["⌘⇧T", chord({ key: "T", shiftKey: true }), "new-window"],
    ["⌘⇧F", chord({ key: "f", shiftKey: true }), "fulltext-search"],
    ["⌘⇧P", chord({ key: "p", shiftKey: true }), "fulltext-search"],
    ["⌘S", chord({ key: "s" }), "save"],
    ["⌘F", chord({ key: "f" }), "find-in-doc"],
    ["⌘E", chord({ key: "e" }), "toggle-main-pane"],
    ["⌘⇧E", chord({ key: "e", shiftKey: true }), "focus-tree-filter"],
    ["⌘N", chord({ key: "n" }), "new-note"],
    ["⌘⇧C", chord({ key: "c", shiftKey: true }), "copy-path"],
    ["⌘B", chord({ key: "b" }), "toggle-sidebar"],
    ["⌘⇧B", chord({ key: "b", shiftKey: true }), "table-view"],
    ["⌘⇧O", chord({ key: "o", shiftKey: true }), "show-outline"],
    ["⌘W", chord({ key: "w" }), "close-tab"],
    ["⌘,", chord({ key: "," }), "nav-back"],
    ["⌘.", chord({ key: "." }), "nav-forward"],
  ];

  for (const [label, c, expected] of cases) {
    it(`${label} → ${expected}`, () => expect(idOf(c)).toBe(expected));
  }

  it("Ctrl도 ⌘와 동등하게 받는다 (비-mac 대비)", () => {
    expect(idOf(chord({ key: "k", metaKey: false, ctrlKey: true }))).toBe("palette");
  });

  it("modifier 없으면 아무것도 안 잡는다", () => {
    expect(idOf(chord({ key: "k", metaKey: false }))).toBeNull();
  });
});

describe("우선순위 — 여기가 깨지면 조용히 엉뚱한 동작을 한다", () => {
  it("⌘⌥B는 컨텍스트 패널이다 (⌘B 사이드바보다 먼저)", () => {
    expect(idOf(chord({ key: "b", altKey: true, code: "KeyB" }))).toBe("toggle-context");
  });

  it("macOS가 ⌥B를 '∫'로 바꿔 보내도 잡는다", () => {
    // e.key만 보면 놓치는 자리. 반대로 code가 빈 환경도 있어 둘 다 허용한다.
    expect(idOf(chord({ key: "∫", altKey: true }))).toBe("toggle-context");
    expect(idOf(chord({ key: "∫", altKey: true, code: "KeyB" }))).toBe("toggle-context");
  });

  it("⌘⌃←/→ 는 nav (⌘ 단독 화살표는 아무것도 아님)", () => {
    expect(idOf(chord({ key: "ArrowLeft", ctrlKey: true }))).toBe("nav-back");
    expect(idOf(chord({ key: "ArrowRight", ctrlKey: true }))).toBe("nav-forward");
    expect(idOf(chord({ key: "ArrowLeft" }))).toBeNull();
  });

  it("shift 유무로 ⌘T/⌘⇧T, ⌘E/⌘⇧E, ⌘F/⌘⇧F가 갈린다", () => {
    expect(idOf(chord({ key: "t" }))).not.toBe(idOf(chord({ key: "t", shiftKey: true })));
    expect(idOf(chord({ key: "e" }))).not.toBe(idOf(chord({ key: "e", shiftKey: true })));
    expect(idOf(chord({ key: "f" }))).not.toBe(idOf(chord({ key: "f", shiftKey: true })));
  });
});

describe("탭 번호", () => {
  it("⌘1~⌘9는 index를 실어 보낸다", () => {
    for (const n of [1, 5, 9]) {
      expect(resolveShortcut(chord({ key: String(n) }), { inEditing: false })).toEqual({
        id: "select-tab",
        index: n,
      });
    }
  });

  it("⌘0은 대상이 아니다", () => {
    expect(idOf(chord({ key: "0" }))).toBeNull();
  });
});

describe("입력 중 가드", () => {
  it("F2·⌘⌫는 입력 중이면 가로채지 않는다", () => {
    const f2 = chord({ key: "F2", metaKey: false });
    const del = chord({ key: "Backspace" });
    expect(idOf(f2)).toBe("rename-note");
    expect(idOf(del)).toBe("delete-note");
    expect(idOf(f2, true)).toBeNull();
    expect(idOf(del, true)).toBeNull();
  });

  it("⌘ 조합은 입력 중에도 살아 있다 (⌘S 등은 에디터 안에서 써야 한다)", () => {
    expect(idOf(chord({ key: "s" }), true)).toBe("save");
  });
});

describe("⌘⇧G — vault 전체 검색", () => {
  it("⌘⇧G가 vault-grep으로 간다", () => {
    expect(idOf(chord({ key: "g", shiftKey: true }))).toBe("vault-grep");
  });

  it("shift 없는 ⌘G는 아무것도 아니다 — 그래프 뷰 제거로 비어 있는 자리다", () => {
    expect(idOf(chord({ key: "g" }))).toBeNull();
  });

  it("Ctrl+Shift+G도 같다 — Windows", () => {
    expect(idOf(chord({ key: "g", metaKey: false, ctrlKey: true, shiftKey: true }))).toBe(
      "vault-grep",
    );
  });
});
