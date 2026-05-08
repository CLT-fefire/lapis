<script lang="ts">
  import {
    tagIndex,
    selectedTag,
    selectTag,
  } from "$lib/stores/tags";
  import {
    selectNote,
    currentNotePath,
    linkIndex,
  } from "$lib/stores/vault";

  function notesForTag(tagKey: string): { path: string; label: string }[] {
    const idx = $tagIndex;
    const links = $linkIndex;
    if (!idx) return [];
    const paths = idx.byTag.get(tagKey);
    if (!paths) return [];
    const out: { path: string; label: string }[] = [];
    for (const p of paths) {
      const info = links?.byPath.get(p);
      out.push({ path: p, label: info?.title ?? info?.source_name ?? p.split("/").pop() ?? p });
    }
    out.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
    return out;
  }
</script>

{#if !$tagIndex || $tagIndex.sortedTags.length === 0}
  <div class="empty">
    <p>태그가 발견되지 않았습니다.</p>
    <p class="hint">frontmatter <code>tags:</code> 또는 본문 <code>#tag</code> 형식</p>
  </div>
{:else if $selectedTag}
  {@const display = $tagIndex.display.get($selectedTag) ?? $selectedTag}
  {@const list = notesForTag($selectedTag)}
  <div class="filter-bar">
    <span class="filter-chip selected">
      #{display}
      <span class="count">{list.length}</span>
      <button class="chip-close" title="필터 해제" onclick={() => selectTag(null)}>×</button>
    </span>
  </div>
  <ul class="note-list">
    {#each list as item (item.path)}
      <li>
        <button
          class="note-row"
          class:active={$currentNotePath === item.path}
          title={item.path}
          onclick={() => selectNote(item.path)}
        >
          <span class="dot">•</span>
          <span class="name">{item.label}</span>
        </button>
      </li>
    {/each}
  </ul>
{:else}
  <ul class="tag-cloud">
    {#each $tagIndex.sortedTags as tagKey (tagKey)}
      {@const display = $tagIndex.display.get(tagKey) ?? tagKey}
      {@const count = $tagIndex.counts.get(tagKey) ?? 0}
      <li>
        <button class="tag-chip" onclick={() => selectTag(tagKey)}>
          <span class="tag-name">#{display}</span>
          <span class="count">{count}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .empty {
    padding: 30px 16px;
    color: #666;
    font-size: 12px;
    text-align: center;
    line-height: 1.6;
  }

  .empty .hint {
    margin-top: 8px;
    color: #555;
  }

  .empty code {
    background: #2a2a2a;
    padding: 1px 5px;
    border-radius: 3px;
    color: #aaa;
  }

  .filter-bar {
    padding: 6px 8px;
    border-bottom: 1px solid #333;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 4px 10px;
    border-radius: 12px;
    background: #2d4a5a;
    color: #fff;
    font-size: 12px;
    font-weight: 600;
  }

  .filter-chip .count {
    color: #9adff7;
    font-weight: 400;
    font-size: 11px;
  }

  .chip-close {
    background: transparent;
    border: none;
    color: #9adff7;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
    font-family: inherit;
  }

  .chip-close:hover {
    color: #fff;
  }

  .tag-cloud {
    list-style: none;
    margin: 0;
    padding: 8px 6px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .tag-cloud li {
    margin: 0;
  }

  .tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 9px;
    border-radius: 11px;
    background: transparent;
    border: 1px solid #2d4a5a;
    color: #6dd6ff;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }

  .tag-chip:hover {
    background: #2d4a5a;
    color: #fff;
    border-color: #6dd6ff;
  }

  .tag-chip .count {
    color: #777;
    font-size: 11px;
  }

  .tag-chip:hover .count {
    color: #aaa;
  }

  .note-list {
    list-style: none;
    margin: 0;
    padding: 8px 6px;
  }

  .note-list li {
    margin: 1px 0;
  }

  .note-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 8px;
    background: transparent;
    border: none;
    color: #aaa;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    border-radius: 4px;
    font-family: inherit;
  }

  .note-row:hover {
    background: #2f2f2f;
  }

  .note-row.active {
    background: #2d4a5a;
    color: #fff;
    font-weight: 600;
    box-shadow: inset 3px 0 0 #6dd6ff;
  }

  .dot {
    color: #555;
    font-size: 9px;
    width: 10px;
    text-align: center;
    flex-shrink: 0;
  }

  .name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }
</style>
