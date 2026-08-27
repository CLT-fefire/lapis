<script lang="ts">
  import "../app.css";
  // ⚠️ import 자체가 `overwriteGetLocale()`를 건다 — 메시지가 그려지기 전이어야 한다.
  import { activeLocale } from "$lib/stores/locale";
  import { applyUserCss, applyColorThemeCss } from "$lib/userCss";
  import { themeCss } from "$lib/colorThemes";
  import { customCss, customCssEnabled, colorTheme } from "$lib/stores/settings";

  let { children } = $props();

  /**
   * 색 테마와 사용자 CSS 주입.
   *
   * ⚠️ **루트 레이아웃에 있어야 한다.** 처음엔 `+page.svelte`에 뒀는데, 그러면 그 라우트가
   * 마운트된 동안에만 주입된다 — `/dev/preview` 같은 다른 라우트에서는 테마를 골라도
   * 아무 일도 안 일어났다(store는 바뀌는데 화면이 안 따라온다). 앱 전체에 걸리는
   * 것이라 앱 전체를 감싸는 곳에 둔다.
   *
   * ⚠️ **테마를 먼저.** 둘 다 `:root` 토큰을 덮어쓰고 특이도가 같아서 나중 것이 이긴다 —
   * 사용자 CSS가 프리셋 위에 얹혀야 한다.
   */
  $effect(() => {
    applyColorThemeCss(themeCss($colorTheme));
    applyUserCss($customCss, $customCssEnabled);
  });
</script>

<!--
  로케일이 바뀌면 트리를 remount한다.

  ⚠️ Paraglide 메시지 함수는 순수 함수라 Svelte가 추적하지 못한다. `setLocale`만으로는
  DOM이 안 바뀌고, Svelte 5는 세밀 갱신이라 **다른 상태를 건드려도 소용없다**(표현식마다
  독립 반응 계산이라 의존이 없으면 영영 재평가되지 않는다). 표현식 자체를 파괴·재생성하는
  `{#key}`만이 통한다 — 대조 실험은 solutions/svelte-issues/paraglide-messages-are-not-reactive.

  루트 한 곳에 거는 대가: 언어를 바꾸면 CodeMirror 인스턴스·스크롤 위치가 초기화된다.
  탭·현재 노트는 store에 있어 살아남는다. 로케일 변경은 드문 조작이라 감수한다.
-->
{#key $activeLocale}
  {@render children()}
{/key}
