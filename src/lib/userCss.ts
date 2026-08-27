/**
 * 사용자 정의 CSS — 계약과 주입.
 *
 * ## 무엇을 보장하나
 *
 * 두 가지**만** 보장한다:
 *
 * 1. `app.css`의 디자인 토큰 (`--surface-*` · `--text-*` · `--r-*` …)
 * 2. 아래 `LAPIS_HOOKS`의 `[data-lapis="…"]` 훅
 *
 * `.file-row` 같은 **내부 클래스는 보장하지 않는다.** 리팩터할 때 자유롭게 바뀌고, 그때
 * 그걸 쓰던 사용자 CSS는 조용히 안 먹는다. 보장 범위를 좁게 잡는 이유가 그것이다 —
 * 넓게 잡으면 내부 구조가 사실상 공개 API가 되어 앞으로 아무것도 못 고친다.
 *
 * ## ⚠️ 자기 발등 찍기
 *
 * `[data-lapis="app"] { display: none }` 한 줄이면 **앱이 안 보이고 설정에도 못 들어간다.**
 * 되돌리는 길이 셋이다:
 *
 * 1. **패닉 단축키** — 키 핸들러는 CSS와 무관하게 돌므로 화면이 새까매도 듣는다. 1차 방어선
 * 2. **`lapis css --off`** — 앱이 아예 안 뜰 때. 설정 JSON을 직접 고친다
 * 3. **설정 파일 삭제** — 최후
 *
 * "적용 전 미리보기"는 방어선이 **아니다.** `display: none`은 미리보기에서도 똑같이 안
 * 보인다. 사용자가 실수를 알아볼 때만 듣는 장치를 안전장치로 세면 안 된다.
 */

/**
 * 사용자 CSS가 붙잡을 수 있는 **안정적인 이름**. 이게 계약이다.
 *
 * ⚠️ 여기서 지우거나 이름을 바꾸면 **남의 CSS가 조용히 안 먹는다.** 늘리는 것은 자유롭지만
 * 줄이는 것은 파괴적 변경이다.
 *
 * ⚠️ 이 목록에 있는 훅이 실제 마크업에 있는지는 `userCssHooks.dom.test.ts`가 본다.
 * 목록에만 있고 DOM에 없으면 문서가 거짓말을 하는 것이고, 그것도 조용하다.
 */
export const LAPIS_HOOKS = [
  "app",
  "rail",
  "sidebar",
  "file-tree",
  "tabs",
  "note-header",
  "note-body",
  "editor",
  "preview",
  "context-panel",
  "modal",
  "palette",
  "settings",
  "statusbar",
  "banner",
] as const;

export type LapisHook = (typeof LAPIS_HOOKS)[number];

/** 주입되는 `<style>`의 식별자. 이것도 훅 이름 규칙을 따른다. */
const STYLE_ID = "user-css";

/**
 * 사용자 CSS를 head **끝**에 넣는다. 마지막이라 특이도만 같으면 이긴다.
 *
 * ⚠️ `<style>` 요소를 지웠다 다시 만들지 않고 **textContent만 바꾼다.** 매번 다시 만들면
 * 순서가 바뀌어 다른 스타일 뒤로 갈 수 있고, 편집기에서 타이핑할 때마다 깜빡인다.
 */
export function applyUserCss(css: string, enabled: boolean): void {
  if (typeof document === "undefined") return;
  let el = document.querySelector<HTMLStyleElement>(`style[data-lapis="${STYLE_ID}"]`);
  if (!el) {
    el = document.createElement("style");
    el.setAttribute("data-lapis", STYLE_ID);
    document.head.appendChild(el);
  }
  // 꺼져 있으면 **빈 문자열**을 넣는다. 요소를 지우지 않는 이유는 위와 같다.
  el.textContent = enabled ? css : "";
}

/**
 * 패닉 단축키인가 — `⌘⇧⌥C` (Windows: `Ctrl+Shift+Alt+C`).
 *
 * ## ⚠️ 왜 `keymap.ts`에 안 넣나
 *
 * `keymap.ts`는 앱의 정상 단축키 표고, 그 매칭은 `resolveShortcut` 한 곳을 지난다.
 * 패닉 키는 **그게 망가졌을 때도 들어야 하는 것**이라 같은 경로에 두면 안 된다.
 * 조건도 일부러 단순하게 뒀다 — 편집 중인지, 모달이 떠 있는지 따지지 않는다.
 *
 * 조합이 긴 이유: 짧으면 실수로 눌러서 자기 CSS가 꺼진 줄 모른다.
 */
export function isPanicChord(e: {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || !e.altKey) return false;
  // ⚠️ ⌥가 문자를 바꾼다(macOS에서 ⌥C는 "ç"). `code`를 먼저 보고 `key`는 보조로 쓴다 —
  //    `keymap.ts`의 `isOptionB`가 같은 이유로 같은 짓을 한다.
  return e.code === "KeyC" || e.key.toLowerCase() === "c" || e.key === "ç" || e.key === "Ç";
}
