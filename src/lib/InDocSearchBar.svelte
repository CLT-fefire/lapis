<script lang="ts">
  import { tick } from "svelte";
  import { inDocSearch, setQuery, closeSearch } from "$lib/stores/inDocSearch";
  import type { SearchTarget } from "$lib/stores/inDocSearch";

  interface Props {
    target: SearchTarget;
    onQuery?: (q: string) => void;
    onNext?: () => void;
    onPrev?: () => void;
    onClosed?: () => void;
  }

  let { target, onQuery, onNext, onPrev, onClosed }: Props = $props();

  let inputEl: HTMLInputElement | undefined = $state();

  const vm = $derived($inDocSearch);
  const active = $derived(vm.open && vm.target === target);

  // 활성화될 때 input에 포커스 + 텍스트 전체 선택
  $effect(() => {
    if (active && inputEl) {
      void tick().then(() => {
        if (!inputEl) return;
        inputEl.focus();
        inputEl.select();
      });
    }
  });

  function handleInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    setQuery(value);
    onQuery?.(value);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeSearch();
      onClosed?.();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrev?.();
      else onNext?.();
    }
  }

  function close() {
    closeSearch();
    onClosed?.();
  }

  const countLabel = $derived(
    vm.query === ""
      ? ""
      : vm.total === 0
        ? "매치 없음"
        : `${vm.current} / ${vm.total}`,
  );

  const disabled = $derived(vm.total === 0);
</script>

{#if active}
  <div class="in-doc-search" role="search">
    <input
      bind:this={inputEl}
      type="text"
      placeholder="현재 노트에서 찾기"
      value={vm.query}
      oninput={handleInput}
      onkeydown={handleKeydown}
      spellcheck="false"
      autocomplete="off"
    />
    <span class="count" class:none={vm.query !== "" && vm.total === 0}>
      {countLabel}
    </span>
    <button
      type="button"
      class="nav"
      title="이전 (Shift+Enter)"
      onclick={() => onPrev?.()}
      disabled={disabled}
      aria-label="이전 매치"
    >▲</button>
    <button
      type="button"
      class="nav"
      title="다음 (Enter)"
      onclick={() => onNext?.()}
      disabled={disabled}
      aria-label="다음 매치"
    >▼</button>
    <button
      type="button"
      class="close"
      title="닫기 (Esc)"
      onclick={close}
      aria-label="검색 닫기"
    >✕</button>
  </div>
{/if}

<style>
  .in-doc-search {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    background: #252526;
    border-bottom: 1px solid #333;
    font-size: 12px;
    color: #e8e8e8;
  }

  input {
    flex: 1;
    min-width: 0;
    padding: 4px 8px;
    background: #1e1e1e;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    color: #e8e8e8;
    font-size: 12px;
    outline: none;
  }

  input:focus {
    border-color: #6dd6ff;
  }

  .count {
    flex-shrink: 0;
    min-width: 56px;
    text-align: right;
    color: #aaa;
    font-variant-numeric: tabular-nums;
  }

  .count.none {
    color: #f47174;
  }

  .nav,
  .close {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    color: #aaa;
    font-size: 11px;
    cursor: pointer;
    padding: 0;
  }

  .nav:hover:not(:disabled),
  .close:hover {
    background: #3a3a3a;
    color: #e8e8e8;
  }

  .nav:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .close {
    margin-left: 2px;
    color: #777;
  }
</style>
