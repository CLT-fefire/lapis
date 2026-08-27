<script lang="ts" module>
  export type ModalZ = "overlay" | "modal" | "modal-nested" | "context";
  export type ModalAlign = "center" | "top";
</script>

<script lang="ts">
  import { onMount, onDestroy, tick, type Snippet } from "svelte";
  import { fade } from "svelte/transition";
  import { backdropFade, cardIn, cardOut } from "$lib/motion";

  interface Props {
    /** ESC / backdrop 클릭 시 호출. */
    onClose: () => void;
    /** 모달 카드 마크업(consumer가 head/body/foot 포함 그대로 제공). */
    children: Snippet;
    /** 세로 정렬 — center(기본) 또는 top(상단 16vh). */
    align?: ModalAlign;
    /** z-index 레이어 — app.css --z-* 척도. */
    z?: ModalZ;
    closeOnBackdrop?: boolean;
    closeOnEsc?: boolean;
    /** backdrop 영역 aria-label(선택). 카드 role=dialog는 consumer가 유지. */
    label?: string;
  }

  let {
    onClose,
    children,
    align = "center",
    z = "modal",
    closeOnBackdrop = true,
    closeOnEsc = true,
    label,
  }: Props = $props();

  let backdropEl: HTMLDivElement | null = $state(null);
  let prevFocused: HTMLElement | null = null;

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function focusables(): HTMLElement[] {
    if (!backdropEl) return [];
    return Array.from(
      backdropEl.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
  }

  onMount(() => {
    prevFocused = document.activeElement as HTMLElement | null;
    // 카드 렌더 후 초기 포커스: [data-autofocus] 우선, 없으면 첫 포커스 요소, 최후엔 backdrop.
    void tick().then(() => {
      if (!backdropEl) return;
      const preferred =
        backdropEl.querySelector<HTMLElement>("[data-autofocus]");
      (preferred ?? focusables()[0] ?? backdropEl).focus();
    });
  });

  onDestroy(() => {
    // 모달 닫힐 때 직전 포커스 복원 (접근성).
    prevFocused?.focus?.();
  });

  function onBackdropClick(e: MouseEvent) {
    if (closeOnBackdrop && e.target === backdropEl) onClose();
  }

  function onKeydown(e: KeyboardEvent) {
    if (closeOnEsc && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    // 포커스 트랩 — Tab이 카드 밖으로 나가지 않게 순환.
    const f = focusables();
    if (f.length === 0) {
      e.preventDefault();
      return;
    }
    const first = f[0];
    const last = f[f.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={backdropEl}
  class="ms-backdrop ms-z-{z} ms-align-{align}"
  aria-label={label}
  tabindex="-1"
  onclick={onBackdropClick}
  onkeydown={onKeydown}
  transition:fade={backdropFade()}
>
  <!-- 카드는 consumer의 snippet이라 여기서 직접 transition을 걸 수 없다. 래퍼를 하나 두고
       backdrop의 가로 정렬을 이 래퍼가 이어받는다(세로 정렬은 backdrop이 유지). -->
  <div class="ms-card-wrap" data-lapis="modal" in:cardIn out:cardOut>
    {@render children()}
  </div>
</div>

<style>
  .ms-backdrop {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    display: flex;
    justify-content: center;
    padding: var(--sp-10);
    overflow: auto;
    outline: none;
  }
  /* 카드 래퍼 — 폭 100%를 차지하고 가로 중앙 정렬만 담당한다. 세로 정렬은 backdrop의
     align-items가 이 래퍼에 걸리므로, 래퍼 높이는 카드 높이를 따라가고 카드가
     세로로 늘어나지 않는다(stretch 회귀 방지). */
  .ms-card-wrap {
    display: flex;
    justify-content: center;
    width: 100%;
  }

  .ms-align-center {
    align-items: center;
  }
  .ms-align-top {
    align-items: flex-start;
    padding-top: 16vh;
  }
  .ms-z-overlay {
    z-index: var(--z-overlay);
  }
  .ms-z-modal {
    z-index: var(--z-modal);
  }
  .ms-z-modal-nested {
    z-index: var(--z-modal-nested);
  }
  .ms-z-context {
    z-index: var(--z-context-menu);
  }
</style>
