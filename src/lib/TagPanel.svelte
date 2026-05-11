<script lang="ts">
  import {
    tagIndex,
    selectedTag,
    selectedTagKind,
    selectTag,
    expandedPrefixes,
    togglePrefix,
  } from "$lib/stores/tags";
  import {
    selectNote,
    currentNotePath,
    linkIndex,
  } from "$lib/stores/vault";

  /**
   * 선택된 태그(leaf 또는 prefix)에 해당하는 노트 목록.
   * - leaf: byTag 정확 매칭
   * - prefix: byPrefix 계층 매칭
   */
  function notesForSelection(
    key: string,
    kind: "leaf" | "prefix",
  ): { path: string; label: string }[] {
    const idx = $tagIndex;
    const links = $linkIndex;
    if (!idx) return [];
    const paths = kind === "prefix" ? idx.byPrefix.get(key) : idx.byTag.get(key);
    if (!paths) return [];
    const out: { path: string; label: string }[] = [];
    for (const p of paths) {
      const info = links?.byPath.get(p);
      out.push({ path: p, label: info?.title ?? info?.source_name ?? p.split("/").pop() ?? p });
    }
    out.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
    return out;
  }

  /** leaf 태그 키에서 prefix 제거한 표시 라벨 (예: `feature/bubble-creation` → `bubble-creation`) */
  function leafLabel(key: string): string {
    const display = $tagIndex?.display.get(key) ?? key;
    const idx = display.lastIndexOf("/");
    return idx === -1 ? display : display.slice(idx + 1);
  }
</script>

{#if !$tagIndex || ($tagIndex.sortedTags.length === 0 && $tagIndex.rootPrefixes.length === 0)}
  <div class="empty">
    <p>태그가 발견되지 않았습니다.</p>
    <p class="hint">frontmatter <code>tags:</code> 항목 (kebab-case, <code>/</code> nested 지원)</p>
  </div>
{:else if $selectedTag}
  {@const key = $selectedTag}
  {@const kind = $selectedTagKind}
  {@const display = $tagIndex.display.get(key) ?? key}
  {@const list = notesForSelection(key, kind)}
  <div class="filter-bar">
    <span class="filter-chip selected" class:prefix={kind === "prefix"}>
      {kind === "prefix" ? `${display}/` : `#${display}`}
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
  <div class="tag-tree">
    <!-- prefix 그룹들 (계층 트리) -->
    {#each $tagIndex.rootPrefixes as prefix (prefix)}
      {@const prefixCount = $tagIndex.prefixCounts.get(prefix) ?? 0}
      {@const children = $tagIndex.prefixChildren.get(prefix) ?? []}
      {@const isOpen = $expandedPrefixes.has(prefix)}
      <div class="prefix-group">
        <div class="prefix-row">
          <button
            class="prefix-toggle"
            onclick={() => togglePrefix(prefix)}
            title={isOpen ? "접기" : "펼치기"}
          >
            <span class="caret" class:open={isOpen}>▸</span>
          </button>
          <button
            class="prefix-name"
            title="이 prefix 하위 모든 노트 보기"
            onclick={() => selectTag(prefix, "prefix")}
          >
            <span class="name">{prefix}/</span>
            <span class="count">{prefixCount}</span>
          </button>
        </div>
        {#if isOpen}
          <ul class="child-list">
            {#each children as childKey (childKey)}
              {@const childCount = $tagIndex.counts.get(childKey) ?? $tagIndex.prefixCounts.get(childKey) ?? 0}
              {@const isSubPrefix = ($tagIndex.prefixCounts.get(childKey) ?? 0) > 0
                && !($tagIndex.byTag.has(childKey))}
              <li>
                <button
                  class="child-chip"
                  class:sub-prefix={isSubPrefix}
                  onclick={() => selectTag(childKey, isSubPrefix ? "prefix" : "leaf")}
                  title={childKey}
                >
                  <span class="name">{isSubPrefix ? `${leafLabel(childKey)}/` : leafLabel(childKey)}</span>
                  <span class="count">{childCount}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/each}

    <!-- flat 태그 (prefix 없는 단일 단어 태그) -->
    {#if $tagIndex.flatTags.length > 0}
      <div class="flat-section">
        <div class="flat-header">기타</div>
        <ul class="flat-list">
          {#each $tagIndex.flatTags as tagKey (tagKey)}
            {@const display = $tagIndex.display.get(tagKey) ?? tagKey}
            {@const count = $tagIndex.counts.get(tagKey) ?? 0}
            <li>
              <button class="flat-chip" onclick={() => selectTag(tagKey, "leaf")}>
                <span class="name">{display}</span>
                <span class="count">{count}</span>
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
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

  .filter-chip.prefix {
    background: #3a4a2d;
    color: #d4e88e;
  }

  .filter-chip .count {
    color: #9adff7;
    font-weight: 400;
    font-size: 11px;
  }

  .filter-chip.prefix .count {
    color: #c3d96b;
  }

  .chip-close {
    background: transparent;
    border: none;
    color: inherit;
    opacity: 0.7;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
    font-family: inherit;
  }

  .chip-close:hover {
    opacity: 1;
  }

  /* 트리 */
  .tag-tree {
    padding: 6px 0;
  }

  .prefix-group {
    margin: 0;
  }

  .prefix-row {
    display: flex;
    align-items: center;
    width: 100%;
  }

  .prefix-toggle {
    background: transparent;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 4px 4px 4px 10px;
    font-family: inherit;
    display: inline-flex;
    align-items: center;
  }

  .caret {
    display: inline-block;
    font-size: 10px;
    width: 10px;
    transition: transform 0.15s;
  }

  .caret.open {
    transform: rotate(90deg);
  }

  .prefix-name {
    flex: 1;
    background: transparent;
    border: none;
    color: #d4e88e;
    font-size: 13px;
    font-weight: 600;
    text-align: left;
    padding: 4px 10px 4px 4px;
    cursor: pointer;
    font-family: inherit;
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    border-radius: 4px;
  }

  .prefix-name:hover {
    background: rgba(212, 232, 142, 0.1);
    color: #e3f29e;
  }

  .prefix-name .count {
    color: #888;
    font-weight: 400;
    font-size: 11px;
  }

  .child-list {
    list-style: none;
    margin: 0 0 4px 0;
    padding: 0 6px 0 24px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .child-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 10px;
    background: transparent;
    border: 1px solid #2d4a5a;
    color: #6dd6ff;
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }

  .child-chip:hover {
    background: #2d4a5a;
    color: #fff;
    border-color: #6dd6ff;
  }

  .child-chip.sub-prefix {
    color: #d4e88e;
    border-color: #3a4a2d;
  }

  .child-chip.sub-prefix:hover {
    background: #3a4a2d;
    color: #e3f29e;
    border-color: #d4e88e;
  }

  .child-chip .count {
    color: #777;
    font-size: 10px;
  }

  .flat-section {
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px solid #2a2a2a;
  }

  .flat-header {
    padding: 4px 14px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #666;
  }

  .flat-list {
    list-style: none;
    margin: 0;
    padding: 4px 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .flat-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 10px;
    background: transparent;
    border: 1px solid #2d4a5a;
    color: #6dd6ff;
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }

  .flat-chip:hover {
    background: #2d4a5a;
    color: #fff;
    border-color: #6dd6ff;
  }

  .flat-chip .count {
    color: #777;
    font-size: 10px;
  }

  /* 노트 리스트 */
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
