import { describe, it, expect, beforeEach } from "vitest";
import { applyUserCss, isPanicChord } from "./userCss";

/**
 * 사용자 정의 CSS의 **주입**과 **탈출구**.
 *
 * ## ⚠️ 브라우저에서 확인하려다 결론을 못 낸 것
 *
 * 실제 페이지에서 `<style>`의 `textContent`에 직접 앱을 숨기는 CSS를 넣고 패닉 키를 쏴 봤다.
 * 결과는 "패닉 뒤 style이 비었다"였는데 **그건 아무것도 증명하지 못한다** — 주입을 담당하는
 * `$effect`가 store를 따라 그 요소를 계속 덮어쓰므로, 내가 넣은 CSS는 애초에 적용된 적이
 * 없었다(앱이 숨겨지지도 않았다). 패닉 키가 아니라 effect가 지운 것일 수도 있다.
 *
 * **"통과처럼 보이는 결과"와 "통과"는 다르다.** 그래서 조각을 따로 검증한다.
 */

const styleEl = () => document.querySelector<HTMLStyleElement>('style[data-lapis="user-css"]');

beforeEach(() => {
  document.head.querySelectorAll('style[data-lapis="user-css"]').forEach((e) => e.remove());
});

describe("주입", () => {
  it("head 끝에 style 요소를 만든다", () => {
    applyUserCss(".x { color: red }", true);
    expect(styleEl()).not.toBeNull();
    expect(styleEl()!.textContent).toBe(".x { color: red }");
    // 마지막이라 특이도만 같으면 이긴다.
    expect(document.head.lastElementChild).toBe(styleEl());
  });

  /**
   * ⚠️ 요소를 지웠다 다시 만들지 **않는다.** 매번 새로 만들면 head 안 순서가 바뀌어 다른
   * 스타일 뒤로 갈 수 있고, 편집기에서 타이핑할 때마다 깜빡인다.
   */
  it("다시 불러도 같은 요소를 재사용한다", () => {
    applyUserCss(".a{}", true);
    const first = styleEl();
    applyUserCss(".b{}", true);
    expect(styleEl()).toBe(first);
    expect(document.head.querySelectorAll('style[data-lapis="user-css"]')).toHaveLength(1);
  });

  it("꺼지면 내용만 비운다 — 요소는 남는다", () => {
    applyUserCss(".x{}", true);
    applyUserCss(".x{}", false);
    expect(styleEl()).not.toBeNull();
    expect(styleEl()!.textContent).toBe("");
  });

  /** 실제로 스타일이 **먹는지**까지 본다. 요소만 있고 안 먹으면 의미가 없다. */
  it("주입한 규칙이 실제로 적용된다", () => {
    const el = document.createElement("div");
    el.setAttribute("data-lapis", "app");
    document.body.appendChild(el);
    try {
      applyUserCss('[data-lapis="app"] { display: none; }', true);
      expect(getComputedStyle(el).display).toBe("none");
      applyUserCss('[data-lapis="app"] { display: none; }', false);
      expect(getComputedStyle(el).display).not.toBe("none");
    } finally {
      el.remove();
    }
  });
});

describe("패닉 조합", () => {
  const chord = (o: Partial<Parameters<typeof isPanicChord>[0]> = {}) =>
    isPanicChord({
      key: "c",
      code: "KeyC",
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: true,
      ...o,
    });

  it("⌘⇧⌥C 와 Ctrl⇧⌥C 를 받는다", () => {
    expect(chord()).toBe(true);
    expect(chord({ metaKey: false, ctrlKey: true })).toBe(true);
  });

  /** ⌥가 문자를 바꾼다 — macOS에서 ⌥C는 "ç"로 온다. `keymap.ts`의 ⌥B와 같은 함정이다. */
  it("⌥가 바꾼 문자로 와도 받는다", () => {
    expect(chord({ key: "ç", code: undefined })).toBe(true);
    expect(chord({ key: "Ç", code: undefined })).toBe(true);
  });

  /**
   * ⚠️ 조합이 헐거우면 **실수로 눌러서 자기 CSS가 꺼진 줄 모른다.** 하나라도 빠지면 아니다.
   */
  it("수식키가 하나라도 빠지면 아니다", () => {
    expect(chord({ shiftKey: false })).toBe(false);
    expect(chord({ altKey: false })).toBe(false);
    expect(chord({ metaKey: false, ctrlKey: false })).toBe(false);
  });

  it("다른 글자는 아니다", () => {
    expect(chord({ key: "x", code: "KeyX" })).toBe(false);
  });
});
