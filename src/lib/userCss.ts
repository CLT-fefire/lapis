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
  // 3.0 에서 셸이 상단바·상태바를 갖는다. 둘 다 창 전체를 가로지르는 줄이라
  // 사용자 CSS 가 가장 먼저 붙잡고 싶어 하는 자리다.
  "titlebar",
  /** vault 미선택 화면 전체(3.0 PR-10). */
  "vault-empty",
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

/** 주입되는 `<style>`의 식별자들. 훅 이름 규칙을 따른다. */
const STYLE_ID = "user-css";
const THEME_STYLE_ID = "color-theme";

/**
 * 사용자 CSS를 head **끝**에 넣는다. 마지막이라 특이도만 같으면 이긴다.
 *
 * ⚠️ `<style>` 요소를 지웠다 다시 만들지 않고 **textContent만 바꾼다.** 매번 다시 만들면
 * 순서가 바뀌어 다른 스타일 뒤로 갈 수 있고, 편집기에서 타이핑할 때마다 깜빡인다.
 */
export function applyUserCss(css: string, enabled: boolean): void {
  if (typeof document === "undefined") return;
  // 꺼져 있으면 **빈 문자열**을 넣는다. 요소를 지우지 않는 이유는 위와 같다.
  styleSlot(STYLE_ID).textContent = enabled ? css : "";
}

/**
 * 색 테마 프리셋 주입.
 *
 * ⚠️ **사용자 CSS보다 먼저** 들어가야 한다. 둘 다 `:root` 토큰을 덮어쓰는데 특이도가
 * 같으므로 **나중 것이 이긴다** — 사용자가 프리셋 위에 자기 색을 얹을 수 있어야 한다.
 * `styleSlot`이 없으면 만들어 append하므로, 이 함수를 먼저 부르는 것으로 순서가 정해진다.
 */
export function applyColorThemeCss(css: string): void {
  if (typeof document === "undefined") return;
  styleSlot(THEME_STYLE_ID).textContent = css;
}

/** `<style data-lapis="…">` 슬롯을 얻거나 만든다. 요소를 재사용해 순서를 지킨다. */
function styleSlot(id: string): HTMLStyleElement {
  let el = document.querySelector<HTMLStyleElement>(`style[data-lapis="${id}"]`);
  if (!el) {
    el = document.createElement("style");
    el.setAttribute("data-lapis", id);
    document.head.appendChild(el);
  }
  return el;
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

/**
 * 편집기가 비었을 때 채워 넣는 **예시**.
 *
 * ## ⚠️ 저장된 값이 아니다
 *
 * 설정에 빈 문자열이 저장돼 있을 때 **편집기 초기 문서로만** 쓴다. 저장을 누르기 전에는
 * 아무것도 적용되지 않고, 전부 주석이라 그대로 저장해도 화면이 안 바뀐다.
 *
 * 기본값 자체를 이걸로 두지 않는 이유: 그러면 "아무것도 설정 안 한 상태"가 사라져서,
 * 사용자가 지워도 다음에 다시 나타나거나 반대로 영영 안 나타난다. **비어 있음은 비어
 * 있음으로 남겨 두고, 보여 주기만 한다.**
 *
 * 내용은 **실제로 동작하는 규칙**을 주석 처리한 것이다. 설명만 있는 예시는 무엇을 붙잡을
 * 수 있는지 안 알려준다 — 주석 하나만 풀면 바로 결과가 보이는 쪽이 배우기 쉽다.
 */
export const EXAMPLE_CSS = [
  "/* Lapis 사용자 정의 CSS",
  " *",
  " * 아래 규칙의 주석을 풀면 바로 적용됩니다. 저장을 눌러야 반영됩니다.",
  " *",
  " * 붙잡을 수 있는 것은 두 가지뿐입니다:",
  " *   1. app.css 의 디자인 토큰 (--surface-* · --text-* · --accent* · --r-* …)",
  " *   2. 아래 목록의 [data-lapis=\"…\"] 훅 17개",
  " *",
  " * .file-row 같은 내부 클래스는 예고 없이 바뀝니다.",
  " *",
  " * ⚠️ 화면을 못 쓰게 만들었다면 ⌘⇧⌥C (Ctrl+Shift+Alt+C) 로 적용을 끕니다.",
  " */",
  "",
  "/* 1) 색 바꾸기 — 토큰만 덮어쓰면 앱 전체가 따라옵니다. */",
  "/*",
  ":root {",
  "  --surface-content: #232830;",
  "}",
  "*/",
  "",
  "/* 2) 액센트는 **셋을 같이** 바꿉니다 (3.0).",
  " *   --accent-solid : 채워진 버튼·선택 배경",
  " *   --accent       : 포커스 링·보더",
  " *   --accent-text  : 글자·링크",
  " *",
  " * 하나만 덮으면 나머지 둘이 옛 색으로 남습니다 — 화면은 멀쩡하고 링크만 다른 색입니다.",
  " * --accent-text 는 배경 대비 4.5:1 을 넘겨야 읽힙니다(밝은 쪽으로).",
  " */",
  "/*",
  ":root {",
  "  --accent-solid: #b8453f;",
  "  --accent: #e0625a;",
  "  --accent-text: #f2938c;",
  "}",
  "*/",
  "",
  "/* 3) 특정 영역만 — 훅으로 붙잡습니다. */",
  "/*",
  "[data-lapis=\"sidebar\"] {",
  "  border-right: 1px solid var(--accent);",
  "}",
  "*/",
  "",
  "/* 4) 본문 글자 — 읽는 화면만 키우기 */",
  "/*",
  "[data-lapis=\"preview\"] {",
  "  font-size: 15px;",
  "  line-height: 1.8;",
  "}",
  "*/",
  "",
  "/* 5) 모션을 느리게/빠르게 (3.0: --dur-fast/base/slow 는 별칭으로만 남습니다) */",
  "/*",
  ":root {",
  "  --dur-1: 60ms;",
  "  --dur-2: 100ms;",
  "  --dur-3: 160ms;",
  "  --dur-4: 240ms;",
  "}",
  "*/",
  "",
  "/* 6) 모서리를 각지게 */",
  "/*",
  ":root {",
  "  --r-sm: 0;",
  "  --r-md: 2px;",
  "  --r-lg: 4px;",
  "}",
  "*/",
].join("\n");
