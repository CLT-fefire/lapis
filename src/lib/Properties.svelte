<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
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
    if (!v.trim()) return { ok: false, reason: m.props_validate_empty() };
    if (v.includes("/")) return { ok: false, reason: m.props_validate_topic_flat() };
    if (!isKebab(v)) return { ok: false, reason: m.props_validate_kebab() };
    return { ok: true };
  }
  function validateTag(v: string): ValidationResult {
    if (!v.trim()) return { ok: false, reason: m.props_validate_empty() };
    if (!isKebab(v)) return { ok: false, reason: m.props_validate_kebab_nested() };
    return { ok: true };
  }
  function validateStem(v: string): ValidationResult {
    if (!v.trim()) return { ok: false, reason: m.props_validate_empty() };
    return { ok: true };
  }
  function validateNonEmpty(v: string): ValidationResult {
    if (!v.trim()) return { ok: false, reason: m.props_validate_empty() };
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

{#snippet addEntry()}
  {#if addPickerOpen}
    <span class="picker-label">{m.props_add_field_label()}</span>
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
    >{m.props_cancel()}</button>
  {:else}
    <button
      type="button"
      class="add-properties-btn"
      onclick={() => (addPickerOpen = true)}
      title={m.props_add_title()}
    >{m.props_add_button()}</button>
  {/if}
{/snippet}

{#if Object.keys(data).length === 0 && !isAuto}
  <div class="properties-empty">{@render addEntry()}</div>
{/if}

{#if Object.keys(data).length > 0}
  <!-- 접기는 감싸는 쪽(ContextPanel의 SidebarSection)이 담당한다 — 자체 <details>를
       두면 헤더가 이중으로 겹친다(2026-08-05 PR-4). auto 표시만 배지로 남긴다. -->
  <div class="properties">
    {#if isAuto}<span class="auto-tag">auto</span>{/if}
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
                  <option value="">{m.props_option_empty()}</option>
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
                    <span class="empty">{m.props_empty_click()}</span>
                  {:else}
                    {value}
                  {/if}
                  <span class="edit-icon" aria-hidden="true">✎</span>
                </button>
              {:else if isChipEditable(key) && key === "tags"}
                <ChipEditor
                  values={arrayOf(value)}
                  displayPrefix="#"
                  placeholder={m.props_tag_placeholder()}
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
                      title={m.props_tag_filter_title()}
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
    {#if isAuto}
      <!-- 합성(auto) properties 표시 중 — 실제 frontmatter가 없으므로 추가 진입점 노출 -->
      <div class="properties-add-footer">{@render addEntry()}</div>
    {/if}
  </div>
{/if}

{#if showNotice}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="notice" onclick={dismissNotice} title={m.props_notice_close()}>
    {m.props_notice()}
  </div>
{/if}

<style>
  .properties {
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    border-radius: var(--r-md);
    padding: var(--sp-4) var(--sp-5);
    margin-bottom: var(--sp-8);
  }

  .properties-empty {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-4) var(--sp-5);
    margin-bottom: var(--sp-8);
    background: var(--surface-raised);
    border: 1px dashed var(--border-default);
    border-radius: var(--r-md);
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }

  .properties-add-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-3);
    margin-top: var(--sp-4);
    padding-top: var(--sp-4);
    border-top: 1px dashed var(--border-default);
  }

  .add-properties-btn {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--accent-hover);
    border-radius: var(--r-sm);
    padding: 5px var(--sp-5);
    font-size: var(--fs-sm);
    cursor: pointer;
    font-family: inherit;
  }
  .add-properties-btn:hover {
    border-color: var(--accent);
    background: var(--accent-bg-subtle);
  }

  .picker-label {
    color: var(--text-muted);
    margin-right: var(--sp-2);
  }

  .add-chip {
    background: var(--accent-bg-subtle);
    border: 1px solid var(--accent-border);
    color: var(--accent-hover);
    border-radius: var(--r-sm);
    padding: 3px 10px;
    font-size: var(--fs-xs);
    cursor: pointer;
    font-family: inherit;
  }
  .add-chip:hover {
    border-color: var(--accent);
    background: var(--accent-bg-subtle);
  }

  .picker-cancel {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: var(--fs-xs);
    cursor: pointer;
    font-family: inherit;
    padding: 3px var(--sp-4);
    margin-left: var(--sp-2);
  }
  .picker-cancel:hover {
    color: var(--text-secondary);
  }

  .auto-tag {
    display: inline-block;
    margin-bottom: var(--sp-3);
    color: var(--text-muted);
    font-weight: 400;
    font-size: var(--fs-xs);
    letter-spacing: 0.01em;
  }

  .properties table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
    font-size: var(--fs-base);
  }

  .properties th {
    text-align: left;
    color: var(--text-muted);
    padding: var(--sp-2) var(--sp-5) var(--sp-2) 0;
    font-weight: 500;
    width: 110px;
    vertical-align: top;
  }

  .properties td {
    padding: var(--sp-2) 0;
    color: var(--text-secondary);
  }

  .edit-trigger {
    background: transparent;
    border: 1px dashed transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: var(--sp-1) var(--sp-3);
    margin: -2px -6px;
    border-radius: var(--r-xs);
    cursor: text;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
  }

  .edit-trigger:hover {
    border-color: var(--accent-border);
    background: var(--accent-bg-subtle);
  }

  .edit-icon {
    opacity: 0;
    color: var(--text-muted);
    font-size: var(--fs-xs);
    transition: opacity 0.1s;
    flex-shrink: 0;
  }

  .edit-trigger:hover .edit-icon {
    opacity: 1;
  }

  .empty {
    color: var(--text-muted);
    font-style: italic;
  }

  .inline-edit {
    width: 100%;
    background: var(--surface-sunken);
    border: 1px solid var(--accent);
    color: var(--text-primary);
    padding: 3px var(--sp-3);
    border-radius: var(--r-xs);
    font-family: inherit;
    font-size: var(--fs-base);
  }

  select.inline-edit {
    cursor: pointer;
  }

  .chip {
    display: inline-block;
    padding: 1px var(--sp-4);
    margin: var(--sp-1) var(--sp-2) var(--sp-1) 0;
    background: var(--accent-bg-subtle);
    border-radius: var(--r-lg);
    font-size: var(--fs-sm);
    color: var(--accent-hover);
  }

  .chip-tag {
    border: 1px solid transparent;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.1s, border-color 0.1s, color 0.1s;
  }

  .chip-tag:hover {
    background: var(--accent-bg-subtle);
    color: var(--text-primary);
    border-color: var(--accent);
  }

  .notice {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: var(--surface-overlay);
    border: 1px solid var(--accent);
    color: var(--text-secondary);
    padding: 10px var(--sp-6);
    border-radius: var(--r-md);
    font-size: var(--fs-sm);
    max-width: var(--modal-w-sm);
    z-index: var(--z-toast);
    cursor: pointer;
    box-shadow: var(--shadow-md);
  }
</style>
