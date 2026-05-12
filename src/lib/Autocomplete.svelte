<script lang="ts">
  import { tick, untrack } from "svelte";

  export interface ValidationResult {
    ok: boolean;
    reason?: string;
  }

  interface Props {
    value?: string;
    placeholder?: string;
    /** 빈 query면 top-N 후보 */
    suggest: (query: string) => string[];
    /** 미지정이면 빈 값만 거부 */
    validate?: (value: string) => ValidationResult;
    /** 자동 포커스 — ChipEditor가 add 모드 진입 시 true */
    autofocus?: boolean;
    /** input이 비어 있을 때 Backspace 누르면 호출. ChipEditor가 마지막 칩 제거에 사용. */
    onbackspaceempty?: () => void;
    /** Enter 또는 dropdown 클릭 시. invalid면 호출 안 됨. */
    oncommit: (value: string) => void;
    /** Esc 또는 blur(invalid 상태) 시 */
    oncancel: () => void;
  }

  let {
    value = "",
    placeholder = "",
    suggest,
    validate,
    autofocus = false,
    onbackspaceempty,
    oncommit,
    oncancel,
  }: Props = $props();

  let inputEl: HTMLInputElement | null = $state(null);
  // 컴포넌트 마운트 시점의 value를 초기 query로만 사용. 이후 query는 사용자 입력으로만 변경.
  let query = $state(untrack(() => value));
  let activeIndex = $state(0);
  let dropdownVisible = $state(false);

  $effect(() => {
    if (autofocus) {
      tick().then(() => {
        inputEl?.focus();
        dropdownVisible = true;
      });
    }
  });

  const suggestions = $derived.by<string[]>(() => suggest(query));

  // active 인덱스 보정
  $effect(() => {
    const len = suggestions.length;
    if (activeIndex >= len) activeIndex = Math.max(0, len - 1);
  });

  const validation = $derived.by<ValidationResult>(() => {
    if (validate) return validate(query);
    return query.trim() ? { ok: true } : { ok: false, reason: "비어 있음" };
  });

  function tryCommit(rawValue: string) {
    const v = rawValue.trim();
    if (!v) {
      oncancel();
      return;
    }
    const res = validate ? validate(v) : { ok: true };
    if (!res.ok) {
      // commit 거부 — input 유지, 사용자가 수정 또는 Esc
      return;
    }
    oncommit(v);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      oncancel();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // 활성 후보가 있으면 그것, 없으면 raw 입력
      const fromSuggestion = suggestions[activeIndex];
      const finalValue =
        fromSuggestion && query.toLowerCase() !== fromSuggestion.toLowerCase()
          ? fromSuggestion
          : query;
      tryCommit(finalValue);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, Math.max(0, suggestions.length - 1));
      dropdownVisible = true;
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      dropdownVisible = true;
      return;
    }
    if (e.key === "Backspace" && query === "" && onbackspaceempty) {
      e.preventDefault();
      onbackspaceempty();
      return;
    }
  }

  function onInput() {
    activeIndex = 0;
    dropdownVisible = true;
  }

  function onBlur() {
    // dropdown 항목 클릭은 mousedown으로 받아 commit이 먼저 실행됨.
    // blur 시 query가 비어 있으면 cancel, 값이 있는데 invalid면 silent cancel.
    setTimeout(() => {
      if (!query.trim()) {
        oncancel();
      } else if (!validation.ok) {
        oncancel();
      } else {
        // 정상 값으로 blur — commit
        tryCommit(query);
      }
    }, 100);
  }

  function pickSuggestion(s: string) {
    tryCommit(s);
  }
</script>

<div class="autocomplete">
  <input
    bind:this={inputEl}
    type="text"
    class="input"
    class:invalid={!validation.ok && query.trim() !== ""}
    {placeholder}
    bind:value={query}
    onkeydown={onKeydown}
    oninput={onInput}
    onblur={onBlur}
    autocomplete="off"
    spellcheck="false"
  />
  {#if !validation.ok && query.trim() !== "" && validation.reason}
    <div class="hint invalid">{validation.reason}</div>
  {/if}
  {#if dropdownVisible && suggestions.length > 0}
    <ul class="dropdown" role="listbox">
      {#each suggestions as s, i}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          class="item"
          class:active={i === activeIndex}
          role="option"
          aria-selected={i === activeIndex}
          onmousedown={(e) => {
            // blur보다 먼저 commit 처리하기 위해 mousedown 사용
            e.preventDefault();
            pickSuggestion(s);
          }}
          onmouseenter={() => (activeIndex = i)}
        >{s}</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .autocomplete {
    position: relative;
    display: inline-block;
    width: 100%;
  }

  .input {
    width: 100%;
    background: #1a1a1a;
    border: 1px solid #6dd6ff;
    color: #fff;
    padding: 3px 6px;
    border-radius: 3px;
    font-family: inherit;
    font-size: 13px;
    outline: none;
  }

  .input.invalid {
    border-color: #f47174;
  }

  .hint {
    margin-top: 2px;
    font-size: 11px;
    color: #888;
  }

  .hint.invalid {
    color: #f47174;
  }

  .dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin: 2px 0 0 0;
    padding: 4px 0;
    list-style: none;
    background: #1f1f1f;
    border: 1px solid #3a3a3a;
    border-radius: 4px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
    max-height: 240px;
    overflow-y: auto;
    z-index: 50;
  }

  .item {
    padding: 4px 10px;
    font-size: 12px;
    color: #ddd;
    cursor: pointer;
  }

  .item.active {
    background: #2d4a5a;
    color: #fff;
  }
</style>
