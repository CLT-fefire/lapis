<script lang="ts">
  import { tick } from "svelte";
  import { patchFrontmatter } from "$lib/frontmatter";
  import { DOC_KIND_ENUM } from "$lib/stores/filters";
  import { selectTag, showTagsTab } from "$lib/stores/tags";
  import { noteContentChanged } from "$lib/stores/editor";

  interface Props {
    data: Record<string, unknown>;
    isAuto: boolean;     // true면 합성 데이터 — 편집 불가
    rawNote: string;     // 현재 노트의 raw (patch 기준)
  }
  let { data, isAuto, rawNote }: Props = $props();

  // 어떤 키를 편집 중인지 — 한 번에 한 행만
  let editingKey = $state<string | null>(null);
  // 편집 중인 임시 값
  let editingValue = $state<string>("");

  let titleInputEl: HTMLInputElement | null = $state(null);
  let docKindSelectEl: HTMLSelectElement | null = $state(null);

  const EDITABLE_FIELDS = ["title", "doc_kind"] as const;
  type EditableField = (typeof EDITABLE_FIELDS)[number];
  function isEditable(key: string): key is EditableField {
    return !isAuto && (EDITABLE_FIELDS as readonly string[]).includes(key);
  }

  // 다른 노트로 이동하면 편집 모드 해제
  $effect(() => {
    const _ = rawNote;
    editingKey = null;
  });

  async function enterEdit(key: EditableField) {
    editingKey = key;
    editingValue = stringOf(data[key]);
    showNoticeIfFirst();
    await tick();
    if (key === "title") titleInputEl?.focus();
    if (key === "doc_kind") docKindSelectEl?.focus();
  }

  function cancelEdit() {
    editingKey = null;
    editingValue = "";
  }

  function commitEdit() {
    if (!editingKey) return;
    const key = editingKey;
    const next = editingValue.trim();
    const current = stringOf(data[key]);
    editingKey = null;
    if (next === current) return;
    const newRaw = patchFrontmatter(rawNote, { [key]: next === "" ? null : next });
    noteContentChanged(newRaw);
  }

  function onInputKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  }

  function stringOf(v: unknown): string {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v;
    return String(v);
  }

  // 첫 인라인 편집 시 1회 안내 토스트
  const NOTICE_KEY = "lapis.fm-edit-notice-shown";
  let showNotice = $state(false);
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;

  function showNoticeIfFirst() {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem(NOTICE_KEY) === "1") return;
    localStorage.setItem(NOTICE_KEY, "1");
    showNotice = true;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (showNotice = false), 5000);
  }

  function dismissNotice() {
    showNotice = false;
    if (noticeTimer) clearTimeout(noticeTimer);
  }

  // doc_kind dropdown용 옵션 — enum 외 값이 현재 들어 있으면 보존
  const docKindOptions = $derived.by<string[]>(() => {
    const cur = stringOf(data.doc_kind);
    const base = [...DOC_KIND_ENUM];
    if (cur && !base.includes(cur)) base.push(cur);
    return base;
  });
</script>

{#if Object.keys(data).length > 0}
  <details class="properties" open>
    <summary>
      Properties ({Object.keys(data).length}){#if isAuto}<span class="auto-tag">· auto</span>{/if}
    </summary>
    <table>
      <tbody>
        {#each Object.entries(data) as [key, value]}
          <tr class:editable={isEditable(key)}>
            <th>{key}</th>
            <td>
              {#if !isAuto && editingKey === key && key === "title"}
                <input
                  bind:this={titleInputEl}
                  class="inline-edit"
                  type="text"
                  bind:value={editingValue}
                  onkeydown={onInputKey}
                  onblur={commitEdit}
                  autocomplete="off"
                  spellcheck="false"
                />
              {:else if !isAuto && editingKey === key && key === "doc_kind"}
                <select
                  bind:this={docKindSelectEl}
                  class="inline-edit"
                  bind:value={editingValue}
                  onchange={commitEdit}
                  onkeydown={onInputKey}
                  onblur={commitEdit}
                >
                  {#each docKindOptions as opt}
                    <option value={opt}>{opt}</option>
                  {/each}
                  <option value="">— 비움 —</option>
                </select>
              {:else if isEditable(key)}
                <button class="edit-trigger" onclick={() => enterEdit(key)}>
                  {#if value === "" || value === null || value === undefined}
                    <span class="empty">— 비어 있음 — (클릭하여 편집)</span>
                  {:else}
                    {value}
                  {/if}
                </button>
              {:else if Array.isArray(value)}
                {#each value as v}
                  {#if key === "tags"}
                    <button
                      class="chip chip-tag"
                      title="이 태그로 사이드바 필터"
                      onclick={() => {
                        selectTag(String(v));
                        showTagsTab();
                      }}
                    >#{v}</button>
                  {:else}
                    <span class="chip">{v}</span>
                  {/if}
                {/each}
              {:else if typeof value === "object" && value !== null}
                <code>{JSON.stringify(value)}</code>
              {:else}
                {value}
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </details>
{/if}

{#if showNotice}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="notice" onclick={dismissNotice} title="닫기">
    Properties 편집 시 frontmatter의 코멘트와 일부 공백이 정규화될 수 있습니다.
  </div>
{/if}

<style>
  .properties {
    background: #252526;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    padding: 8px 12px;
    margin-bottom: 24px;
  }

  .properties summary {
    cursor: pointer;
    color: #6dd6ff;
    font-weight: 600;
    font-size: 13px;
    user-select: none;
  }

  .auto-tag {
    margin-left: 6px;
    color: #888;
    font-weight: 400;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .properties table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
    font-size: 13px;
  }

  .properties th {
    text-align: left;
    color: #888;
    padding: 4px 12px 4px 0;
    font-weight: 500;
    width: 110px;
    vertical-align: top;
  }

  .properties td {
    padding: 4px 0;
    color: #ddd;
  }

  .edit-trigger {
    background: transparent;
    border: 1px dashed transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 2px 6px;
    margin: -2px -6px;
    border-radius: 3px;
    cursor: text;
    width: 100%;
    display: block;
  }

  .edit-trigger:hover {
    border-color: #3a4a5a;
    background: #1a2a33;
  }

  .empty {
    color: #666;
    font-style: italic;
  }

  .inline-edit {
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

  select.inline-edit {
    cursor: pointer;
  }

  .chip {
    display: inline-block;
    padding: 1px 8px;
    margin: 2px 4px 2px 0;
    background: #2d4a5a;
    border-radius: 10px;
    font-size: 12px;
    color: #9adff7;
  }

  .chip-tag {
    border: 1px solid transparent;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.1s, border-color 0.1s, color 0.1s;
  }

  .chip-tag:hover {
    background: #355a6e;
    color: #fff;
    border-color: #6dd6ff;
  }

  .notice {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #2a2a2a;
    border: 1px solid #6dd6ff;
    color: #ddd;
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 12px;
    max-width: 360px;
    z-index: 1200;
    cursor: pointer;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
  }
</style>
