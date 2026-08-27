/**
 * 테마 — **다크 하나뿐이다.**
 *
 * 예전엔 `light` · `dark` · `system` 셋이었고, `app.css`가 같은 값을 세 곳에 갖고 있었다
 * (`:root` · `[data-theme="light"]` · `prefers-color-scheme` 안의 `[data-theme="system"]`).
 * 뒤의 둘은 값이 중복이라 파일 주석이 **"항상 함께 수정할 것"** 이라고 경고하고 있었고,
 * 어긋나도 아무 에러가 안 났다.
 *
 * 색을 바꾸는 길은 이제 **사용자 정의 CSS**다. 우리가 유지하는 두 번째 팔레트를 만들지 않는다.
 *
 * ## ⚠️ 왜 파일을 지우지 않았나
 *
 * `data-theme` 속성을 계속 세운다. 사용자 CSS가 `:root[data-theme="dark"]`를 앵커로 쓸 수
 * 있고, 나중에 테마가 다시 늘어날 여지를 없앨 이유가 없다. **한 곳에서 세우는 것**이
 * 여러 곳에 흩어진 것보다 낫다.
 */

/** 지금은 하나뿐이다. 늘어나면 여기가 갈라지는 자리다. */
export type ThemeMode = "dark";

export const THEME_ATTR = "dark";

/**
 * 시동 시 1회. `app.html`의 인라인 스크립트가 first-paint 전에 이미 세우지만
 * (FOUC 방지), 그 스크립트가 없는 환경(테스트·미리보기 라우트)을 위해 여기서도 세운다.
 */
export function restoreTheme(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = THEME_ATTR;
}
