<script lang="ts">
  import type { Snippet } from "svelte";
  import { ChevronDown, ChevronRight, type LucideIcon } from "@lucide/svelte";

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
    children: Snippet;
    /** 펼침 시 남은 공간을 채움(Files 트리 등 주 콘텐츠). */
    grow?: boolean;
  }
  let {
    icon: Icon,
    label,
    open,
    count = null,
    onToggle,
    children,
    grow = false,
  }: Props = $props();

  function compactCount(n: number): string {
    return n > 99 ? "99+" : String(n);
  }
</script>

<section class="section" class:grow={grow && open}>
  <button class="section-header" aria-expanded={open} onclick={onToggle}>
    <span class="chevron" aria-hidden="true">
      {#if open}<ChevronDown size={13} />{:else}<ChevronRight size={13} />{/if}
    </span>
    <span class="icon" aria-hidden="true"><Icon size={15} /></span>
    <span class="label">{label}</span>
    {#if count != null && count > 0}
      <span class="badge">{compactCount(count)}</span>
    {/if}
  </button>
  {#if open}
    <div class="body">
      {@render children()}
    </div>
  {/if}
</section>

<style>
  .section {
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid var(--border-subtle);
    min-height: 0;
  }

  /* 펼친 주 콘텐츠(Files)는 남은 세로 공간을 차지 */
  .section.grow {
    flex: 1;
    min-height: 0;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    width: 100%;
    padding: var(--sp-3) 10px;
    background: var(--surface-raised);
    border: none;
    cursor: pointer;
    font-family: inherit;
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
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
    font-size: 10px;
    padding: 1px 5px;
    border-radius: var(--r-lg);
    text-transform: none;
    letter-spacing: normal;
    font-weight: 500;
    flex-shrink: 0;
    line-height: 1.3;
  }

  .body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .section.grow > .body {
    flex: 1;
  }
</style>
