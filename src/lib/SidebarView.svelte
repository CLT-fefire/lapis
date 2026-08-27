<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * 사이드바의 **단일 뷰 셸** — 제목 · 액션 · 본문.
   *
   * ## ⚠️ `SidebarSection` 을 대체한다
   *
   * 저쪽은 아코디언이라 "열림/닫힘"과 "높이"를 들었다. 뷰가 하나면 둘 다 없다 — 뷰는
   * 항상 열려 있고 항상 잔여 공간 전부를 쓴다. 그래서 props 가 절반으로 줄었다.
   *
   * ⚠️ **본문에 높이를 명시적으로 준다.** 파일 트리의 가상 스크롤이
   * `position: absolute; inset: 0` 을 전제하는데, 그 전제가 예전에는 아코디언이 준 고정
   * 높이에서 왔다. 여기서 `min-height: 0` + `flex: 1` 로 같은 것을 주지 않으면 트리가
   * 무한히 자라고 **네이티브 휠 스크롤이 죽는다** — 에러 없이.
   */

  interface Props {
    title: string;
    /** 제목 옆 개수. 0이면 안 그린다. */
    count?: number;
    /** 제목 줄 오른쪽 — 뷰별 액션 버튼들. */
    actions?: Snippet;
    /** 제목 줄 아래 — 필터 입력 등 상시 노출 컨트롤. */
    toolbar?: Snippet;
    children: Snippet;
  }

  let { title, count = 0, actions, toolbar, children }: Props = $props();
</script>

<section class="view" aria-label={title}>
  <header class="view-head">
    <h2 class="view-title">
      {title}
      {#if count > 0}<span class="view-count">{count.toLocaleString()}</span>{/if}
    </h2>
    {#if actions}
      <div class="view-actions">{@render actions()}</div>
    {/if}
  </header>

  {#if toolbar}
    <div class="view-toolbar">{@render toolbar()}</div>
  {/if}

  <div class="view-body">{@render children()}</div>
</section>

<style>
  .view {
    display: flex;
    flex-direction: column;
    height: 100%;
    /* ⚠️ 이게 없으면 아래 `min-height: 0` 이 아무 일도 안 한다(flex 자식의 기본 min-height
       는 auto 라 내용이 부모를 밀어낸다). */
    min-height: 0;
  }

  .view-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    height: var(--control-h-sm);
    padding: 0 var(--sp-3);
    flex: none;
  }

  .view-title {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    margin: 0;
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
    min-width: 0;
  }

  .view-count {
    font-weight: 400;
    letter-spacing: 0;
    color: var(--text-disabled);
  }

  .view-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
  }

  .view-toolbar {
    padding: 0 var(--sp-3) var(--sp-2);
    flex: none;
  }

  /**
   * ⚠️ **flex 컬럼이어야 한다.** 파일 뷰의 `.files-pane` 이 `flex: 1; min-height: 0` 으로
   * 잔여 높이를 받고, 그 안의 가상 스크롤이 `position: absolute; inset: 0` 으로 그 높이에
   * 기댄다. 여기가 블록이면 `flex: 1` 이 아무 일도 안 하고 트리가 내용만큼 자란다 —
   * 그러면 `inset: 0` 이 잘못된 높이를 잡고 **네이티브 휠 스크롤이 죽는다.** 에러는 없다.
   *
   * 그 전제는 예전에 아코디언이 준 고정 높이에서 왔다. 아코디언을 없애면서 같이 사라질
   * 뻔했다.
   */
  .view-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: auto;
    position: relative;
  }
</style>
