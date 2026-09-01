import { describe, it, expect } from "vitest";
import { NOTE_EXTENSIONS, hasNoteExt, noteExtOf, stripNoteExt, withNoteExt } from "./notePath";

/**
 * "노트 파일이란 무엇인가" — **이 규칙의 주인.**
 *
 * ## 🔴 왜 함수가 넷이나 필요한가
 *
 * `noteStem` 하나로는 부족해서 네 곳이 자기 정규식을 다시 썼고, 그중 셋이 틀렸다.
 * 필요했던 것이 각각 달랐기 때문이다:
 *
 * | 필요 | 예전에 한 짓 | 지금 |
 * |---|---|---|
 * | 이름 붙이기 | `raw.endsWith(".md") ? raw : raw + ".md"` | `withNoteExt` |
 * | 확장자 벗기기(파일명) | `basename.replace(/\.(md\|mmd\|markdown)$/i, "")` | `stripNoteExt` |
 * | 링크 다시 쓰기 | `` `${stem}.md` `` — **원래 확장자를 버렸다** | `noteExtOf` 로 보존 |
 * | 이게 노트인가 | 제각각 | `hasNoteExt` |
 *
 * ⚠️ `vault.rs` 의 `already_has_supported_ext` 와 **같은 답**이어야 한다.
 * 🔴 macOS 쪽 vault 는 `.mmd` 를 많이 쓴다 — Windows vault 에 0개라고 안전한 게 아니다.
 */

describe("무엇이 노트 확장자인가", () => {
  it("md 와 mmd 둘뿐이다", () => {
    expect([...NOTE_EXTENSIONS]).toEqual(["md", "mmd"]);
  });

  /** ⚠️ `markdown` 은 **아니다.** Rust 인덱서가 안 받는다 — 네 곳이 이걸 벗기고 있었다. */
  it("markdown 은 노트 확장자가 아니다", () => {
    expect(hasNoteExt("note.markdown")).toBe(false);
    expect(stripNoteExt("note.markdown")).toBe("note.markdown");
  });
});

describe("hasNoteExt", () => {
  it("둘 다 받는다", () => {
    expect(hasNoteExt("a.md")).toBe(true);
    expect(hasNoteExt("a.mmd")).toBe(true);
  });

  it("대소문자를 안 가린다", () => {
    expect(hasNoteExt("a.MD")).toBe(true);
    expect(hasNoteExt("a.MMD")).toBe(true);
  });

  /** ⚠️ 느슨하게 보면 `.amd` 까지 받는다 — 점 뒤 전체가 확장자여야 한다. */
  it("비슷한 것은 안 받는다", () => {
    for (const n of ["a.amd", "a.mdx", "a.txt", "a", "amd"]) expect(hasNoteExt(n)).toBe(false);
  });
});

describe("withNoteExt — 이름에 확장자 붙이기", () => {
  it("없으면 md 를 붙인다", () => {
    expect(withNoteExt("plain")).toBe("plain.md");
  });

  it("이미 md 면 그대로", () => {
    expect(withNoteExt("note.md")).toBe("note.md");
  });

  /**
   * 🔴 **이게 버그였다.** `lapis new diagram.mmd` 가 `diagram.mmd.md` 를 만들었다.
   * `vault.rs` 의 rename 은 같은 판정을 제대로 하고 있었다 — 같은 규칙이 두 곳, 한쪽만 맞음.
   */
  it("이미 mmd 면 md 를 덧붙이지 않는다", () => {
    expect(withNoteExt("diagram.mmd"), "확장자가 두 번 붙었다").toBe("diagram.mmd");
  });

  it("대소문자가 달라도 안 덧붙인다", () => {
    expect(withNoteExt("A.MMD")).toBe("A.MMD");
  });

  it("경로가 섞여 있어도 마지막 조각으로 판정한다", () => {
    expect(withNoteExt("sub/dir/note.mmd")).toBe("sub/dir/note.mmd");
    expect(withNoteExt("sub/dir/note")).toBe("sub/dir/note.md");
  });
});

describe("stripNoteExt — 파일명에서 확장자만", () => {
  it("둘 다 벗긴다", () => {
    expect(stripNoteExt("a.md")).toBe("a");
    expect(stripNoteExt("a.mmd")).toBe("a");
  });

  it("대소문자를 안 가린다", () => {
    expect(stripNoteExt("A.MD")).toBe("A");
  });

  /** ⚠️ `noteStem` 과 달리 **경로를 안 자른다.** 부르는 쪽이 이미 basename 인 경우가 있다. */
  it("경로를 안 자른다", () => {
    expect(stripNoteExt("sub/a.md")).toBe("sub/a");
  });

  it("이름 안의 점은 안 건드린다", () => {
    expect(stripNoteExt("2026-08-30.회고.md")).toBe("2026-08-30.회고");
  });
});

/**
 * 🔴 **원래 확장자를 알아야 링크를 되쓸 수 있다.**
 *
 * 이름 바꾸기가 마크다운 링크를 되쓸 때 예전엔 무조건 `.md` 를 붙였다. `.mmd` 노트의
 * 이름을 바꾸면 `[글](old.mmd)` 이 `[글](new.md)` 가 되어 **가리키는 파일이 없어진다.**
 * 에러는 없다.
 */
describe("noteExtOf — 원래 확장자", () => {
  it("붙어 있는 그대로 돌려준다", () => {
    expect(noteExtOf("a.md")).toBe("md");
    expect(noteExtOf("a.mmd")).toBe("mmd");
  });

  /** ⚠️ 대소문자도 **그대로**다 — 되쓸 때 원문을 보존해야 한다. */
  it("대소문자를 보존한다", () => {
    expect(noteExtOf("a.MMD")).toBe("MMD");
  });

  it("노트가 아니면 null", () => {
    expect(noteExtOf("a.txt")).toBeNull();
    expect(noteExtOf("a")).toBeNull();
  });
});
