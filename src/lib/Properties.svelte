<script lang="ts">
  import { tick } from "svelte";
  import { get } from "svelte/store";
  import { patchFrontmatter, addFrontmatterKey, isKebab } from "$lib/frontmatter";
  import { DOC_KIND_ENUM, topicCounts } from "$lib/stores/filters";
  import { selectTag, showTagsTab, tagIndex } from "$lib/stores/tags";
  import { linkIndex } from "$lib/stores/vault";
  import { noteContentChanged } from "$lib/stores/editor";
  import Autocomplete from "$lib/Autocomplete.svelte";
  import ChipEditor from "$lib/ChipEditor.svelte";
  import type { ValidationResult } from "$lib/Autocomplete.svelte";

  interface Props {
    data: Record<string, unknown>;
    isAuto: boolean; // true면 합성 데이터 — 편집 불가
    rawNote: string; // 현재 노트의 raw (patch 기준)
  }
  let { data, isAuto, rawNote }: Props = $props();

  // 단일 값 필드의 편집 상태 (title / doc_kind / topic). 칩 필드는 ChipEditor가 자체 관리.
  let editingKey = $state<string | null>(null);
  let editingValue = $state<string>("");

  let titleInputEl: HTMLInputElement | null = $state(null);
  let docKindSelectEl: HTMLSelectElement | null = $state(null);

  const SINGLE_FIELDS = ["title", "doc_kind", "topic"] as const;
  const CHIP_FIELDS = ["tags", "aliases", "related"] as const;
  type SingleField = (typeof SINGLE_FIELDS)[number];
  type ChipField = (typeof CHIP_FIELDS)[number];

  /** 빈 frontmatter에서 보여줄 picker 상태. 사용자가 명시적으로 토글. */
  let addPickerOpen = $state(false);

  /** picker에서 노출할 키 + 기본값. chip 필드는 빈 배열로 시작. */
  const ADDABLE_FIELDS: Array<{ key: string; defaultValue: unknown; label: string }> = [
    { key: "title", defaultValue: "", label: "title" },
    { key: "doc_kind", defaultValue: "", label: "doc_kind" },
    { key: "topic", defaultValue: "", label: "topic" },
    { key: "tags", defaultValue: [] as string[], label: "tags" },
    { key: "aliases", defaultValue: [] as string[], label: "aliases" },
    { key: "related", defaultValue: [] as string[], label: "related" },
  ];

  async function addField(key: string, defaultValue: unknown) {
    const newRaw = addFrontmatterKey(rawNote, key, defaultValue);
    if (newRaw === rawNote) return; // 이미 존재 — noop
    noteContentChanged(newRaw);
    addPickerOpen = false;
    // 단일 필드는 추가 직후 편집 진입. chip 필드는 ChipEditor가 직접 chip 추가.
    if ((SINGLE_FIELDS as readonly string[]).includes(key)) {
      await tick();
      enterEdit(key as SingleField);
    }
  }

  function isSingleEditable(key: string): key is SingleField {
    return !isAuto && (SINGLE_FIELDS as readonly string[]).includes(key);
  }
  function isChipEditable(key: string): key is ChipField {
    return !isAuto && (CHIP_FIELDS as readonly string[]).includes(key);
  }

  // 다른 노트로 이동하면 편집 모드 해제
  $effect(() => {
    const _ = rawNote;
    editingKey = null;
  });

  async function enterEdit(key: SingleField) {
    editingKey = key;
    editingValue = stringOf(data[key]);
    showNoticeIfFirst();
    await tick();
    if (key === "title") titleInputEl?.focus();
    if (key === "doc_kind") docKindSelectEl?.focus();
    // topic은 Autocomplete가 autofocus prop으로 직접 focus
  }

  function cancelEdit() {
    editingKey = null;
    editingValue = "";
  }

  // title / doc_kind 용 — input/select bind:value에 연결된 editingValue 사용
  function commitSimple() {
    if (!editingKey) return;
    const key = editingKey;
    const next = editingValue.trim();
    const current = stringOf(data[key]);
    editingKey = null;
    if (next === current) return;
    const newRaw = patchFrontmatter(rawNote, { [key]: next === "" ? null : next });
    noteContentChanged(newRaw);
  }

  // Autocomplete 용 — 명시적 value 전달
  function commitAutocomplete(key: SingleField, value: string) {
    editingKey = null;
    const current = stringOf(data[key]);
    if (value === current) return;
    const newRaw = patchFrontmatter(rawNote, { [key]: value === "" ? null : value });
    noteContentChanged(newRaw);
  }

  function commitChips(key: ChipField, next: string[]) {
    const current = arrayOf(data[key]);
    if (sameArray(current, next)) return;
    showNoticeIfFirst();
    const newRaw = patchFrontmatter(rawNote, { [key]: next });
    noteContentChanged(newRaw);
  }

  function onInputKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitSimple();
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

  function arrayOf(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x));
  }

  function sameArray(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // === 자동완성 함수 ===
  function suggestTopics(q: string): string[] {
    return rankSuggest(q, [...get(topicCounts).keys()]);
  }

  function suggestTags(q: string): string[] {
    const idx = get(tagIndex);
    if (!idx) return [];
    // leaf + root prefix (끝에 `/` 보존)
    const leaves = idx.sortedTags;
    const prefixes = idx.rootPrefixes.map((p) => `${p}/`);
    return rankSuggest(q, [...leaves, ...prefixes]);
  }

  function suggestStems(q: string): string[] {
    const idx = get(linkIndex);
    if (!idx) return [];
    const stems = [...idx.byPath.values()].map((info) => info.source_name);
    return rankSuggest(q, stems);
  }

  function rankSuggest(q: string, source: string[], max = 10): string[] {
    const qLower = q.toLowerCase();
    const seen = new Set<string>();
    const uniq = source.filter((s) => {
      const k = s.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (!qLower) return uniq.slice(0, max);
    return uniq
      .filter((s) => s.toLowerCase().includes(qLower))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(qLower);
        const bStarts = b.toLowerCase().startsWith(qLower);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        return a.localeCompare(b);
      })
      .slice(0, max);
  }

  // === 검증 ===
  function validateTopic(v: string): ValidationResult {
    if (!v.trim()) return { ok: false, reason: "비어 있음" };
    if (v.includes("/")) return { ok: false, reason: "topic은 nested 금지 — 단일 kebab" };
    if (!isKebab(v)) return { ok: false, reason: "kebab-case (소문자 + 하이픈)" };
    return { ok: true };
  }
  function validateTag(v: string): ValidationResult {
    if (!v.trim()) return { ok: false, reason: "비어 있음" };
    if (!isKebab(v)) return { ok: false, reason: "kebab-case + 옵션 `/` nested" };
    return { ok: true };
  }
  function validateStem(v: string): ValidationResult {
    if (!v.trim()) return { ok: false, reason: "비어 있음" };
    return { ok: true };
  }
  function validateNonEmpty(v: string): ValidationResult {
    if (!v.trim()) return { ok: false, reason: "비어 있음" };
    return { ok: true };
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

{#if Object.keys(data).length === 0 && !isAuto}
  <div class="properties-empty">
    {#if addPickerOpen}
      <span class="picker-label">추가할 필드:</span>
      {#each ADDABLE_FIELDS as field}
        <button
          type="button"
          class="add-chip"
          onclick={() => addField(field.key, field.defaultValue)}
        >+ {field.label}</button>
      {/each}
      <button
        type="button"
        class="picker-cancel"
        onclick={() => (addPickerOpen = false)}
      >취소</button>
    {:else}
      <button
        type="button"
        class="add-properties-btn"
        onclick={() => (addPickerOpen = true)}
        title="이 노트에 frontmatter 필드를 추가합니다"
      >＋ Properties 추가</button>
    {/if}
  </div>
{/if}

{#if Object.keys(data).length > 0}
  <details class="properties" open>
    <summary>
      Properties ({Object.keys(data).length}){#if isAuto}<span class="auto-tag">· auto</span>{/if}
    </summary>
    <table>
      <tbody>
        {#each Object.entries(data) as [key, value]}
          <tr class:editable={isSingleEditable(key) || isChipEditable(key)}>
            <th>{key}</th>
            <td>
              {#if !isAuto && editingKey === key && key === "title"}
                <input
                  bind:this={titleInputEl}
                  class="inline-edit"
                  type="text"
                  bind:value={editingValue}
                  onkeydown={onInputKey}
                  onblur={commitSimple}
                  autocomplete="off"
                  spellcheck="false"
                />
              {:else if !isAuto && editingKey === key && key === "doc_kind"}
                <select
                  bind:this={docKindSelectEl}
                  class="inline-edit"
                  bind:value={editingValue}
                  onchange={commitSimple}
                  onkeydown={onInputKey}
                  onblur={commitSimple}
                >
                  {#each docKindOptions as opt}
                    <option value={opt}>{opt}</option>
                  {/each}
                  <option value="">— 비움 —</option>
                </select>
              {:else if !isAuto && editingKey === key && key === "topic"}
                <Autocomplete
                  autofocus
                  value={editingValue}
                  placeholder="topic (kebab-case)"
                  suggest={suggestTopics}
                  validate={validateTopic}
                  oncommit={(v) => commitAutocomplete("topic", v)}
                  oncancel={cancelEdit}
                />
              {:else if isSingleEditable(key)}
                <button class="edit-trigger" onclick={() => enterEdit(key)}>
                  {#if value === "" || value === null || value === undefined}
                    <span class="empty">— 비어 있음 — (클릭하여 편집)</span>
                  {:else}
                    {value}
                  {/if}
                  <span class="edit-icon" aria-hidden="true">✎</span>
                </button>
              {:else if isChipEditable(key) && key === "tags"}
                <ChipEditor
                  values={arrayOf(value)}
                  displayPrefix="#"
                  placeholder="태그 (kebab-case)"
                  suggest={suggestTags}
                  validate={validateTag}
                  onchange={(next) => commitChips("tags", next)}
                />
              {:else if isChipEditable(key) && key === "aliases"}
                <ChipEditor
                  values={arrayOf(value)}
                  placeholder="alias"
                  validate={validateNonEmpty}
                  onchange={(next) => commitChips("aliases", next)}
                />
              {:else if isChipEditable(key) && key === "related"}
                <ChipEditor
                  values={arrayOf(value)}
                  placeholder="related note stem"
                  suggest={suggestStems}
                  validate={validateStem}
                  onchange={(next) => commitChips("related", next)}
                />
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

  .properties-empty {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    margin-bottom: 24px;
    background: #1f1f1f;
    border: 1px dashed #3a3a3a;
    border-radius: 6px;
    font-size: 12px;
    color: #888;
  }

  .add-properties-btn {
    background: transparent;
    border: 1px solid #444;
    color: #9adff7;
    border-radius: 4px;
    padding: 5px 12px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }
  .add-properties-btn:hover {
    border-color: #6dd6ff;
    background: #2a3a44;
  }

  .picker-label {
    color: #888;
    margin-right: 4px;
  }

  .add-chip {
    background: #2a3a44;
    border: 1px solid #3a4d58;
    color: #9adff7;
    border-radius: 4px;
    padding: 3px 10px;
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
  }
  .add-chip:hover {
    border-color: #6dd6ff;
    background: #34505e;
  }

  .picker-cancel {
    background: transparent;
    border: none;
    color: #888;
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
    padding: 3px 8px;
    margin-left: 4px;
  }
  .picker-cancel:hover {
    color: #ccc;
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .edit-trigger:hover {
    border-color: #3a4a5a;
    background: #1a2a33;
  }

  .edit-icon {
    opacity: 0;
    color: #888;
    font-size: 11px;
    transition: opacity 0.1s;
    flex-shrink: 0;
  }

  .edit-trigger:hover .edit-icon {
    opacity: 1;
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
