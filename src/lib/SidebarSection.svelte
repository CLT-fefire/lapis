<script lang="ts">
  import type { Snippet } from "svelte";
  import { ChevronRight, type LucideIcon } from "@lucide/svelte";
  import { fly } from "svelte/transition";
  import { sectionReveal } from "$lib/motion";

  /**
   * 사이드바 세로 아코디언 섹션 1개 (옵션 B). 헤더(chevron + lucide 아이콘 + 레이블 + badge)
   * 클릭 = 개별 접기/펼치기. 펼침 시 children(패널 콘텐츠) 렌더.
   */
  interface Props {
    /** lucide 아이콘 컴포넌트. */
    icon: LucideIcon;
    label: string;
    open: boolean;
    /** 우측 카운트 배지(null/0이면 숨김). */
    count?: number | null;
    onToggle: () => void;
    /** 고정 높이(px). null이면 가용 공간 균등 분배(flex). */
    height?: number | null;
    /** 하단 리사이즈 핸들 표시(마지막 펼친 섹션이 아닐 때). */
    resizable?: boolean;
    /** 핸들 드래그 — 새 절대 높이(px). 클램프는 store reducer가. */
    onResize?: (height: number) => void;
    /** 핸들 더블클릭 — 균등 분배로 리셋. */
    onResizeReset?: () => void;
    children: Snippet;
  }
  let {
    icon: Icon,
    label,
    open,
    count = null,
    onToggle,
    height = null,
    resizable = false,
    onResize,
    onResizeReset,
    children,
  }: Props = $props();

  // 12000+ 노트 vault에서는 태그·필터 카운트가 세 자리를 훌쩍 넘는다. 99+로 접으면
  // "많다"는 것 말고는 아무 정보가 없어 상한을 9999+로 올렸다(2026-08-05).
  function compactCount(n: number): string {
    return n > 9999 ? "9999+" : String(n);
  }

  // === 리사이즈 핸들 드래그 ===
  // 드래그 시작 시 섹션의 실제 렌더 높이를 측정해 절대 높이로 전환(미설정[flex]에서도 자연 연속).
  let sectionEl = $state<HTMLElement | null>(null);
  let dragStartY = 0;
  let dragStartH = 0;
  let dragging = $state(false);

  function onHandleDown(e: PointerEvent) {
    if (!sectionEl || !onResize) return;
    dragging = true;
    dragStartY = e.clientY;
    dragStartH = sectionEl.getBoundingClientRect().height;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onHandleMove(e: PointerEvent) {
    if (!dragging) return;
    onResize?.(dragStartH + (e.clientY - dragStartY));
  }
  function onHandleUp(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }
</script>

<section
  class="section"
  class:open
  bind:this={sectionEl}
  style={open && height != null ? `flex: 0 0 ${height}px` : ""}
>
  <button class="section-header" aria-expanded={open} onclick={onToggle}>
    <!-- 아이콘을 교체하면(ChevronDown ↔ ChevronRight) 회전을 애니메이션할 수 없다.
         하나로 고정하고 CSS로 90° 돌린다 — Discord 카테고리와 같은 방식. -->
    <span class="chevron" aria-hidden="true">
      <ChevronRight size={13} />
    </span>
    <span class="icon" aria-hidden="true"><Icon size={15} /></span>
    <span class="label">{label}</span>
    {#if count != null && count > 0}
      <span class="badge">{compactCount(count)}</span>
    {/if}
  </button>
  {#if open}
    <div class="body" transition:fly={sectionReveal()}>
      {@render children()}
    </div>
    {#if resizable}
      <div
        class="resize-handle"
        class:dragging
        role="separator"
        aria-orientation="horizontal"
        aria-label="{label} 섹션 높이 조절"
        title="드래그로 높이 조절 · 더블클릭 = 자동"
        onpointerdown={onHandleDown}
        onpointermove={onHandleMove}
        onpointerup={onHandleUp}
        ondblclick={() => onResizeReset?.()}
      ></div>
    {/if}
  {/if}
</section>

<style>
  .section {
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid var(--border-subtle);
    min-height: 0;
  }

  /* 닫힌 섹션 = 헤더만(고정 높이). */
  .section:not(.open) {
    flex: 0 0 auto;
  }

  /* 펼친 섹션 = 가용 공간 분배(여러 개면 균등). 콘텐츠는 섹션 안에서 스크롤 →
     섹션 간 겹침 차단(특히 Files 가상스크롤의 absolute 자식 격리). */
  .section.open {
    flex: 1 1 0;
    min-height: 0;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    width: 100%;
    padding: var(--sp-3) var(--sp-5);
    background: var(--surface-raised);
    border: none;
    cursor: pointer;
    font-family: inherit;
    font-size: var(--fs-xs);
    /* Discord 채널 카테고리의 어휘 — 작게·굵게·대문자. PR-2에서 "2016년대 관용구"로
       걷어냈다가 되돌린 것: Discord는 실제로 카테고리에 uppercase를 쓴다.
       (한글 레이블에는 uppercase가 적용되지 않아 무해하다.) */
    text-transform: uppercase;
    letter-spacing: 0.02em;
    font-weight: 700;
    color: var(--text-muted);
    transition: color var(--dur-fast);
  }

  .section-header:hover {
    color: var(--text-secondary);
  }

  .section-header:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .chevron,
  .icon {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }

  /* 펼침 = chevron 90° 회전. 높이 변화는 flex가 즉시 처리하므로, 이 회전과
     콘텐츠 fly가 "펼쳐진다"는 인상을 만든다. */
  .chevron {
    transition: transform var(--dur-base) var(--ease-out);
  }
  .section.open .chevron {
    transform: rotate(90deg);
  }

  .chevron {
    color: var(--text-muted);
  }

  .label {
    flex: 1;
    min-width: 0;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    background: var(--accent-bg-subtle);
    color: var(--accent-hover);
    font-size: var(--fs-xs);
    padding: var(--sp-1) var(--sp-3);
    border-radius: var(--r-lg);
    text-transform: none;
    letter-spacing: normal;
    font-weight: 500;
    flex-shrink: 0;
    line-height: 1.3;
    /* 카운트가 자주 바뀌는 자리라 숫자 폭을 고정 — 배지가 들썩이지 않는다. */
    font-variant-numeric: tabular-nums;
  }

  .body {
    flex: 1;
    min-height: 0;
    /* 가상스크롤 등 absolute 자식을 이 섹션 안에 가둠(섹션 간 겹침 방지). */
    position: relative;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  /* 섹션 하단 리사이즈 핸들 — 펼친 섹션 사이 경계를 드래그해 높이 조절. */
  .resize-handle {
    flex: none;
    height: 6px;
    margin-top: -3px; /* 콘텐츠 영역과 겹쳐 두께 체감 줄이되 클릭 타겟은 유지 */
    cursor: row-resize;
    background: transparent;
    position: relative;
    z-index: 1;
    touch-action: none; /* pointer 드래그 중 스크롤 제스처 차단 */
  }

  /* 가운데 1px 가이드 — hover/드래그 시에만 강조해 평소엔 조용히. */
  .resize-handle::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 1px;
    background: var(--border-default);
    transform: translateY(-50%);
    transition: background var(--dur-fast);
  }

  .resize-handle:hover::after,
  .resize-handle.dragging::after {
    background: var(--accent);
    height: 2px;
  }
</style>
