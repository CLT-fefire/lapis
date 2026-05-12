<script lang="ts">
  import Autocomplete from "$lib/Autocomplete.svelte";
  import type { ValidationResult } from "$lib/Autocomplete.svelte";

  interface Props {
    values: string[];
    placeholder?: string;
    /** 없으면 자동완성 dropdown 안 보이고 자유 텍스트만 (aliases 같은 케이스) */
    suggest?: (query: string) => string[];
    validate?: (value: string) => ValidationResult;
    /** 칩 표시 시 prefix (예: "#"). value 자체엔 포함 안 됨 */
    displayPrefix?: string;
    onchange: (next: string[]) => void;
  }

  let { values, placeholder = "", suggest, validate, displayPrefix = "", onchange }: Props = $props();

  let adding = $state(false);

  function startAdding() {
    adding = true;
  }

  function commitNew(v: string) {
    const trimmed = v.trim();
    if (!trimmed) {
      adding = false;
      return;
    }
    // 중복 거부 (대소문자 무시)
    if (!values.some((x) => x.toLowerCase() === trimmed.toLowerCase())) {
      onchange([...values, trimmed]);
    }
    // 한 번 commit 후엔 add 모드 종료. 연속 추가는 + 다시 클릭.
    adding = false;
  }

  function cancelAdd() {
    adding = false;
  }

  function removeAt(idx: number) {
    const next = [...values];
    next.splice(idx, 1);
    onchange(next);
  }

  function removeLast() {
    if (values.length === 0) return;
    const next = values.slice(0, -1);
    onchange(next);
  }

  // suggest가 없는 경우 (aliases) — 모든 query에 대해 빈 배열 반환 → dropdown 안 보임
  const effectiveSuggest = $derived.by<(q: string) => string[]>(() => {
    if (suggest) return suggest;
    return () => [];
  });
</script>

<div class="chip-editor">
  {#each values as v, i (v + "@" + i)}
    <span class="chip">
      {displayPrefix}{v}
      <button
        class="x"
        type="button"
        title="제거"
        aria-label={`${v} 제거`}
        onclick={() => removeAt(i)}
      >×</button>
    </span>
  {/each}
  {#if adding}
    <span class="adding">
      <Autocomplete
        autofocus
        {placeholder}
        suggest={effectiveSuggest}
        {validate}
        onbackspaceempty={removeLast}
        oncommit={commitNew}
        oncancel={cancelAdd}
      />
    </span>
  {:else}
    <button class="add-btn" type="button" title="추가" onclick={startAdding}>+</button>
  {/if}
</div>

<style>
  .chip-editor {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    width: 100%;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 4px 1px 8px;
    background: #2d4a5a;
    border-radius: 10px;
    font-size: 12px;
    color: #9adff7;
    line-height: 1.6;
  }

  .x {
    background: transparent;
    border: none;
    color: #9adff7;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
    border-radius: 50%;
    opacity: 0.7;
  }

  .x:hover {
    background: #355a6e;
    color: #fff;
    opacity: 1;
  }

  .add-btn {
    background: transparent;
    border: 1px dashed #444;
    color: #888;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .add-btn:hover {
    border-color: #6dd6ff;
    color: #6dd6ff;
  }

  .adding {
    flex: 1;
    min-width: 140px;
  }
</style>
