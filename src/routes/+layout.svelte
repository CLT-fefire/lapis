<script lang="ts">
  import "../app.css";
  // ⚠️ import 자체가 `overwriteGetLocale()`를 건다 — 메시지가 그려지기 전이어야 한다.
  import { activeLocale } from "$lib/stores/locale";

  let { children } = $props();
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
