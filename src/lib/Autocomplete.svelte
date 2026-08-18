<script lang="ts">
  import { tick, untrack } from "svelte";
  import { scale } from "svelte/transition";
  import { menuPop } from "$lib/motion";

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

  /**
   * 드롭다운 위치 — `position: fixed` 좌표.
   *
   * ⚠️ `position: absolute`로는 안 된다. 이 컴포넌트는 `.context-panel`
   * (`overflow-y: auto`) 안에서 렌더되므로 absolute 드롭다운이 패널 경계에서 잘린다.
   * fixed는 뷰포트 기준이라 안 잘리는 대신 좌표를 직접 계산하고, 스크롤·리사이즈마다
   * 다시 맞춰야 한다. ContextMenu와 같은 방식.
   */
  let pos = $state<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  let flipped = $state(false);

  /** 드롭다운 최대 높이 — 뒤집기 판정과 CSS `max-height` 양쪽이 이 값을 쓴다. */
  const DROPDOWN_MAX_H = 240;
  /** 입력 필드와의 간격 — `--sp-1`. */
  const GAP = 2;

  /**
   * 입력을 잘라내는 조상들 — 드롭다운을 열 때 한 번만 찾아 캐시한다.
   * `getComputedStyle`은 비싸서 스크롤 핸들러에서 매번 돌 게 못 된다.
   */
  let clippers: HTMLElement[] = [];

  function collectClippers() {
    const found: HTMLElement[] = [];
    for (let el = inputEl?.parentElement ?? null; el; el = el.parentElement) {
      const { overflowX, overflowY } = getComputedStyle(el);
      if (/auto|scroll|hidden/.test(overflowX + overflowY)) found.push(el);
    }
    clippers = found;
  }

  /**
   * 입력이 스크롤 컨테이너 밖으로 밀려났는지. fixed 드롭다운은 조상 `overflow`에
   * 안 잘리므로, 안 잘리는 만큼 "언제 숨길지"를 직접 판정해야 한다. 안 그러면
   * 패널을 스크롤했을 때 드롭다운만 허공에 남는다.
   */
  function clippedOutOfView(r: DOMRect): boolean {
    for (const el of clippers) {
      const cr = el.getBoundingClientRect();
      if (r.bottom <= cr.top || r.top >= cr.bottom) return true;
    }
    return r.bottom <= 0 || r.top >= window.innerHeight;
  }

  function measure() {
    if (!inputEl) return;
    const r = inputEl.getBoundingClientRect();
    if (clippedOutOfView(r)) {
      pos = null;
      return;
    }
    const below = window.innerHeight - r.bottom;
    // 아래가 좁고 위가 더 넓을 때만 뒤집는다 — 둘 다 좁으면 아래 유지가 자연스럽다.
    flipped = below < DROPDOWN_MAX_H + GAP && r.top > below;
    pos = flipped
      ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + GAP }
      : { left: r.left, width: r.width, top: r.bottom + GAP };
  }

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

  // 드롭다운이 열려 있는 동안만 좌표를 유지한다. scroll은 버블링하지 않으므로 capture로
  // 받아야 조상 스크롤 컨테이너(.context-panel 등)의 스크롤까지 잡힌다.
  $effect(() => {
    if (!dropdownVisible || suggestions.length === 0) {
      pos = null;
      return;
    }
    collectClippers();
    measure();
    const onReflow = () => measure();
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
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
  {#if dropdownVisible && suggestions.length > 0 && pos}
    <ul
      class="dropdown"
      class:flip={flipped}
      role="listbox"
      transition:scale={menuPop()}
      style:left="{pos.left}px"
      style:width="{pos.width}px"
      style:top={pos.top != null ? `${pos.top}px` : "auto"}
      style:bottom={pos.bottom != null ? `${pos.bottom}px` : "auto"}
      style:max-height="{DROPDOWN_MAX_H}px"
    >
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
    /* 드롭다운이 fixed라 여기엔 position이 필요 없다. */
    display: inline-block;
    width: 100%;
  }

  .input {
    width: 100%;
    background: var(--surface-sunken);
    border: 1px solid var(--accent);
    color: var(--text-primary);
    padding: 3px var(--sp-3);
    border-radius: var(--r-xs);
    font-family: inherit;
    font-size: var(--fs-base);
  }

  .input.invalid {
    border-color: var(--danger);
  }

  .hint {
    margin-top: var(--sp-1);
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }

  .hint.invalid {
    color: var(--danger);
  }

  .dropdown {
    /* 좌표는 measure()가 인라인으로 준다. */
    position: fixed;
    /* 입력 필드 쪽에서 자라난다 — 아래로 펼치면 윗변, 뒤집으면 아랫변이 기준. */
    transform-origin: top center;
    margin: 0;
    padding: var(--sp-2) 0;
    list-style: none;
    background: var(--surface-overlay);
    border: 1px solid var(--border-default);
    border-radius: var(--r-sm);
    box-shadow: var(--shadow-md);
    overflow-y: auto;
    z-index: var(--z-dropdown);
  }

  .dropdown.flip {
    transform-origin: bottom center;
  }

  .item {
    padding: var(--sp-2) 10px;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .item.active {
    background: var(--accent-bg-subtle);
    color: var(--text-primary);
  }
</style>
