<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import {
    DOC_KIND_ENUM,
    docKindCounts,
    topicCounts,
    selectedDocKinds,
    selectedTopics,
    toggleDocKind,
    toggleTopic,
    clearFilters,
    applyFilters,
  } from "$lib/stores/filters";
  import {
    selectNote,
    currentNotePath,
    linkIndex,
  } from "$lib/stores/vault";
  import type { LinkInfo } from "$lib/tauri/notes";

  // doc_kind 표시 순서 — enum 순서 (사용자가 추가한 신규 doc_kind도 뒤에 붙임)
  const sortedDocKinds = $derived.by<string[]>(() => {
    const known = new Set(DOC_KIND_ENUM);
    const counts = $docKindCounts;
    const extra = [...counts.keys()].filter((k) => !known.has(k)).sort();
    return [...DOC_KIND_ENUM.filter((k) => counts.has(k)), ...extra];
  });

  const sortedTopics = $derived.by<string[]>(() => {
    return [...$topicCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k]) => k);
  });

  const filteredNotes = $derived.by<{ path: string; label: string; topic: string | null; doc_kind: string | null }[]>(() => {
    const idx = $linkIndex;
    if (!idx) return [];
    const matched: LinkInfo[] = applyFilters(
      idx.byPath.values(),
      $selectedDocKinds,
      $selectedTopics,
    );
    return matched
      .map((info) => ({
        path: info.source_path,
        label: info.title ?? info.source_name,
        topic: info.topic,
        doc_kind: info.doc_kind,
      }))
      .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
  });

  const hasAnySelection = $derived($selectedDocKinds.size + $selectedTopics.size > 0);
</script>

{#if $docKindCounts.size === 0 && $topicCounts.size === 0}
  <div class="empty">
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    <p>{@html m.filters_empty()}</p>
    <p class="hint">{m.filters_empty_hint()}</p>
  </div>
{:else}
  <div class="facet-area">
    <!-- doc_kind facet -->
    {#if $docKindCounts.size > 0}
      <section class="facet">
        <header class="facet-header">
          <span>{m.filters_kind()}</span>
          <span class="facet-meta">{$docKindCounts.size}</span>
        </header>
        <div class="chip-row">
          {#each sortedDocKinds as kind (kind)}
            {@const count = $docKindCounts.get(kind) ?? 0}
            {@const active = $selectedDocKinds.has(kind)}
            <button
              class="facet-chip kind-chip"
              class:active
              onclick={() => toggleDocKind(kind)}
              title={`${kind} (${count})`}
            >
              <span class="name">{kind}</span>
              <span class="count">{count}</span>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    <!-- topic facet -->
    {#if $topicCounts.size > 0}
      <section class="facet">
        <header class="facet-header">
          <span>{m.filters_topic()}</span>
          <span class="facet-meta">{$topicCounts.size}</span>
        </header>
        <div class="chip-row">
          {#each sortedTopics as topic (topic)}
            {@const count = $topicCounts.get(topic) ?? 0}
            {@const active = $selectedTopics.has(topic)}
            <button
              class="facet-chip topic-chip"
              class:active
              onclick={() => toggleTopic(topic)}
              title={`${topic} (${count})`}
            >
              <span class="name">{topic}</span>
              <span class="count">{count}</span>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    {#if hasAnySelection}
      <div class="action-bar">
        <span class="match-count">{filteredNotes.length} matched</span>
        <button class="clear-btn" onclick={clearFilters}>{m.filters_clear()}</button>
      </div>
    {/if}
  </div>

  {#if hasAnySelection}
    {#if filteredNotes.length === 0}
      <div class="empty small">{m.filters_no_match()}</div>
    {:else}
      <ul class="note-list">
        {#each filteredNotes as item (item.path)}
          <li>
            <button
              class="note-row"
              class:active={$currentNotePath === item.path}
              title={item.path}
              onclick={() => selectNote(item.path)}
            >
              <span class="name">{item.label}</span>
              <span class="meta-line">
                {#if item.doc_kind}<span class="meta kind">{item.doc_kind}</span>{/if}
                {#if item.topic}<span class="meta topic">{item.topic}</span>{/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <div class="empty small">{m.filters_pick_hint()}</div>
  {/if}
{/if}

<style>
  .empty {
    padding: 30px var(--sp-6);
    color: var(--text-muted);
    font-size: var(--fs-sm);
    text-align: center;
    line-height: 1.6;
  }

  .empty.small {
    padding: var(--sp-6) 14px;
    font-size: var(--fs-xs);
  }

  /* ⚠️ `:global()` — 인라인 마크업이 있어 `{@html}`로 그린다. Svelte scoped CSS는
     `{@html}` 주입 요소에 안 붙는다(스코프 클래스 미부착). */
  .empty :global(code) {
    background: var(--surface-overlay);
    padding: 1px 5px;
    border-radius: var(--r-xs);
    color: var(--text-secondary);
  }

  .empty .hint {
    margin-top: var(--sp-4);
    color: var(--text-disabled);
  }

  .facet-area {
    border-bottom: 1px solid var(--border-subtle);
    padding: var(--sp-3) 0 var(--sp-2) 0;
  }

  .facet {
    padding: var(--sp-3) 10px;
  }

  .facet-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 10px;
    letter-spacing: 0.01em;
    color: var(--text-muted);
    padding: 0 var(--sp-1) var(--sp-2) var(--sp-1);
  }

  .facet-meta {
    color: var(--text-disabled);
  }

  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }

  .facet-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-1) var(--sp-4);
    border-radius: var(--r-lg);
    background: transparent;
    border: 1px solid var(--border-default);
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    cursor: pointer;
    font-family: inherit;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }

  .facet-chip:hover {
    border-color: var(--border-strong);
    color: var(--text-secondary);
  }

  .facet-chip .count {
    color: var(--text-muted);
    font-size: 10px;
  }

  /* doc_kind 활성 — 청록 */
  .kind-chip.active {
    background: var(--accent-bg-subtle);
    border-color: var(--accent);
    color: var(--text-primary);
  }
  .kind-chip.active .count {
    color: var(--accent-hover);
  }

  /* topic 활성 — 보라 (graph related와 같은 톤) */
  .topic-chip.active {
    background: var(--violet-bg-subtle);
    border-color: var(--violet);
    color: var(--text-primary);
  }
  .topic-chip.active .count {
    color: var(--violet);
  }

  .action-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-3) var(--sp-5) var(--sp-1) var(--sp-5);
    font-size: 11px;
  }

  .match-count {
    color: var(--text-secondary);
  }

  .clear-btn {
    background: transparent;
    border: none;
    color: var(--accent-text);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--fs-xs);
    text-decoration: underline;
    padding: 0;
  }

  .clear-btn:hover {
    color: var(--accent-hover);
  }

  .note-list {
    list-style: none;
    margin: 0;
    padding: var(--sp-4) var(--sp-3);
  }

  .note-list li {
    margin: 1px 0;
  }

  .note-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--sp-1);
    width: 100%;
    padding: 5px 10px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: var(--fs-base);
    text-align: left;
    cursor: pointer;
    border-radius: var(--r-sm);
    font-family: inherit;
  }

  .note-row:hover {
    background: var(--surface-overlay);
  }

  .note-row.active {
    background: var(--accent-bg-subtle);
    color: var(--text-primary);
    font-weight: 600;
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .meta-line {
    display: inline-flex;
    gap: 5px;
    flex-wrap: wrap;
  }

  .meta {
    font-size: 10px;
    padding: 0 5px;
    border-radius: var(--r-lg);
    line-height: 1.5;
  }

  .meta.kind {
    background: var(--accent-bg-subtle);
    color: var(--accent-hover);
  }

  .meta.topic {
    background: var(--violet-bg-subtle);
    color: var(--violet);
  }
</style>
