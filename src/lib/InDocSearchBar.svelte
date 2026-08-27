<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { tick } from "svelte";
  import {
    inDocSearch,
    setQuery,
    closeSearch,
    toggleOption,
  } from "$lib/stores/inDocSearch";
  import type { SearchTarget, InDocSearchOptions } from "$lib/stores/inDocSearch";

  interface Props {
    target: SearchTarget;
    onQuery?: (q: string) => void;
    onNext?: () => void;
    onPrev?: () => void;
    onClosed?: () => void;
    /** 옵션(case/regex/wholeWord) 토글 시 호출. 호출자는 같은 쿼리로 재검색해야 함. */
    onOptionsChanged?: (opts: InDocSearchOptions) => void;
  }

  let { target, onQuery, onNext, onPrev, onClosed, onOptionsChanged }: Props = $props();

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

  function onToggle(key: keyof InDocSearchOptions) {
    toggleOption(key);
    // 토글 직후 store가 갱신된 옵션으로 재검색 콜백 발화.
    // $inDocSearch.options는 toggleOption이 동기적으로 set하므로 즉시 읽어도 안전.
    onOptionsChanged?.($inDocSearch.options);
  }

  const countLabel = $derived(
    vm.query === ""
      ? ""
      : vm.regexError
        ? m.search_regex_error()
        : vm.total === 0
          ? m.search_no_match()
          : `${vm.current} / ${vm.total}`,
  );

  const disabled = $derived(vm.total === 0);
</script>

{#if active}
  <div class="in-doc-search" role="search">
    <input
      bind:this={inputEl}
      type="text"
      placeholder={vm.options.regex ? m.search_placeholder_regex() : m.search_placeholder_plain()}
      value={vm.query}
      oninput={handleInput}
      onkeydown={handleKeydown}
      spellcheck="false"
      autocomplete="off"
      class:invalid={vm.regexError}
    />
    <button
      type="button"
      class="opt"
      class:active={vm.options.caseSensitive}
      title={m.search_case_title()}
      onclick={() => onToggle("caseSensitive")}
      aria-pressed={vm.options.caseSensitive}
      aria-label={m.search_case_aria()}
    >Aa</button>
    <button
      type="button"
      class="opt"
      class:active={vm.options.wholeWord}
      title={m.search_word_title()}
      onclick={() => onToggle("wholeWord")}
      aria-pressed={vm.options.wholeWord}
      aria-label={m.search_word_aria()}
    >W</button>
    <button
      type="button"
      class="opt"
      class:active={vm.options.regex}
      title={m.search_regex_title()}
      onclick={() => onToggle("regex")}
      aria-pressed={vm.options.regex}
      aria-label={m.search_regex_aria()}
    >.*</button>
    <span class="count" class:none={vm.query !== "" && (vm.total === 0 || vm.regexError)}>
      {countLabel}
    </span>
    <button
      type="button"
      class="nav"
      title={m.search_prev_title()}
      onclick={() => onPrev?.()}
      disabled={disabled}
      aria-label={m.search_prev_aria()}
    >▲</button>
    <button
      type="button"
      class="nav"
      title={m.search_next_title()}
      onclick={() => onNext?.()}
      disabled={disabled}
      aria-label={m.search_next_aria()}
    >▼</button>
    <button
      type="button"
      class="close"
      title={m.search_close_title()}
      onclick={close}
      aria-label={m.search_close_aria()}
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
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-4);
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border-default);
    font-size: var(--fs-sm);
    color: var(--text-primary);
  }

  input {
    flex: 1;
    min-width: 0;
    padding: var(--sp-2) var(--sp-4);
    background: var(--surface-base);
    border: 1px solid var(--border-default);
    border-radius: var(--r-sm);
    color: var(--text-primary);
    font-size: var(--fs-sm);
  }

  input:focus {
    border-color: var(--accent);
  }

  input.invalid {
    border-color: var(--danger);
  }

  .count {
    flex-shrink: 0;
    min-width: 56px;
    text-align: right;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .count.none {
    color: var(--danger-text);
  }

  .opt {
    flex-shrink: 0;
    height: var(--control-h-sm);
    min-width: 26px;
    padding: 0 var(--sp-3);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--border-default);
    border-radius: var(--r-xs);
    color: var(--text-muted);
    font-size: var(--fs-xs);
    font-family: var(--font-mono);
    cursor: pointer;
  }

  .opt:hover {
    background: var(--surface-overlay);
    color: var(--text-primary);
  }

  .opt.active {
    background: var(--accent-bg-subtle);
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .nav,
  .close {
    flex-shrink: 0;
    width: 24px;
    height: var(--control-h-sm);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--r-xs);
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    cursor: pointer;
    padding: 0;
  }

  .nav:hover:not(:disabled),
  .close:hover {
    background: var(--surface-overlay);
    color: var(--text-primary);
  }

  .nav:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .close {
    margin-left: var(--sp-1);
    color: var(--text-muted);
  }
</style>
