<script lang="ts">
  import { selectNote } from "$lib/stores/vault";
  import { fetchBacklinkContext, type BacklinkContext } from "$lib/backlinks";
  import type { LinkInfo } from "$lib/tauri/notes";
  import type { RelationGroup } from "$lib/relations";

  // Phase A-2 — 현재 노트의 "이웃": frontmatter 관계(타입별) + 역방향 + 본문 백링크.
  interface Props {
    targetNote: LinkInfo | null;
    /** 이 노트가 frontmatter로 선언한 관계 (타입별 그룹). */
    outgoing: RelationGroup[];
    /** 이 노트를 가리키는 다른 노트의 관계 (역방향, 타입별 그룹). */
    incoming: RelationGroup[];
    /** 본문 wikilink/md-link로 이 노트를 인용한 노트들 (평면). */
    backlinks: LinkInfo[];
  }
  let { targetNote, outgoing, incoming, backlinks }: Props = $props();

  // 본문 백링크 칩 펼침 + 스니펫 fetch 상태 (기존 Backlinks 로직 그대로).
  let expanded = $state<Set<string>>(new Set());
  let contexts = $state<Map<string, BacklinkContext>>(new Map());
  let loading = $state<Set<string>>(new Set());

  // targetNote 변경 시 펼침/로딩 리셋. 캐시(contexts)는 모듈 캐시가 있으므로 유지.
  $effect(() => {
    const _ = targetNote?.source_path;
    expanded = new Set();
    loading = new Set();
  });

  async function toggle(source: LinkInfo) {
    const key = source.source_path;
    if (expanded.has(key)) {
      const next = new Set(expanded);
      next.delete(key);
      expanded = next;
      return;
    }

    const next = new Set(expanded);
    next.add(key);
    expanded = next;

    if (contexts.has(key) || !targetNote) return;

    const nextLoading = new Set(loading);
    nextLoading.add(key);
    loading = nextLoading;

    try {
      const ctx = await fetchBacklinkContext(source, targetNote);
      const nextCtx = new Map(contexts);
      nextCtx.set(key, ctx);
      contexts = nextCtx;
    } catch (e) {
      console.warn("fetchBacklinkContext failed", e);
    } finally {
      const after = new Set(loading);
      after.delete(key);
      loading = after;
    }
  }

  /** 관계 타입(필드명)을 사람이 읽기 좋게: `parent_plan` → "Parent plan". */
  function humanize(type: string): string {
    const s = type.replace(/[_-]+/g, " ").trim();
    return s.length === 0 ? type : s.charAt(0).toUpperCase() + s.slice(1);
  }

  const hasAny = $derived(
    outgoing.length > 0 || incoming.length > 0 || backlinks.length > 0,
  );
</script>

{#if hasAny}
  <section class="neighborhood">
    {#if outgoing.length > 0}
      <div class="rel-block">
        <h3>→ Relations</h3>
        {#each outgoing as group (group.type)}
          <div class="rel-group">
            <span class="rel-type">{humanize(group.type)}</span>
            <ul class="rel-list">
              {#each group.notes as note (note.source_path)}
                <li>
                  <button
                    class="chip"
                    title={note.source_path}
                    onclick={() => selectNote(note.source_path)}
                  >
                    {note.title ?? note.source_name}
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    {/if}

    {#if incoming.length > 0}
      <div class="rel-block">
        <h3>← Referenced by</h3>
        {#each incoming as group (group.type)}
          <div class="rel-group">
            <span class="rel-type">{humanize(group.type)}</span>
            <ul class="rel-list">
              {#each group.notes as note (note.source_path)}
                <li>
                  <button
                    class="chip"
                    title={note.source_path}
                    onclick={() => selectNote(note.source_path)}
                  >
                    {note.title ?? note.source_name}
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    {/if}

    {#if backlinks.length > 0}
      <div class="rel-block">
        <h3>↰ Backlinks · {backlinks.length}</h3>
        <ul class="backlink-list">
          {#each backlinks as bl (bl.source_path)}
            {@const isOpen = expanded.has(bl.source_path)}
            {@const ctx = contexts.get(bl.source_path)}
            {@const isLoading = loading.has(bl.source_path)}
            <li class:expanded={isOpen}>
              <div class="row">
                <button
                  class="chevron"
                  type="button"
                  aria-expanded={isOpen}
                  aria-label={isOpen ? "스니펫 접기" : "스니펫 펼치기"}
                  title={isOpen ? "접기" : "본문 인용 위치 보기"}
                  onclick={() => toggle(bl)}
                >{isOpen ? "▾" : "▸"}</button>
                <button
                  class="chip"
                  title={bl.source_path}
                  onclick={() => selectNote(bl.source_path)}
                >
                  {bl.title ?? bl.source_name}
                </button>
              </div>
              {#if isOpen}
                <div class="snippet-box">
                  {#if isLoading}
                    <span class="placeholder">…</span>
                  {:else if ctx && ctx.matched}
                    <p class="snippet">{ctx.snippet}</p>
                  {:else if ctx}
                    <p class="snippet no-match">본문에 직접 인용 없음</p>
                  {:else}
                    <span class="placeholder">…</span>
                  {/if}
                  <button class="open-link" type="button" onclick={() => selectNote(bl.source_path)}>
                    노트 열기 →
                  </button>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>
{/if}

<style>
  .neighborhood {
    margin-top: 36px;
    padding-top: 18px;
    border-top: 1px solid var(--border-default);
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  h3 {
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    margin: 0 0 10px 0;
    font-weight: 600;
  }

  /* === 관계 그룹 (Relations / Referenced by) === */
  .rel-group {
    margin-bottom: var(--sp-4);
  }
  .rel-group:last-child {
    margin-bottom: 0;
  }

  .rel-type {
    display: block;
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    font-weight: 500;
    margin-bottom: var(--sp-2);
  }

  .rel-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }

  .rel-list .chip {
    border: 1px solid var(--accent-border);
    border-radius: var(--r-full);
  }

  /* === 본문 백링크 (펼침 스니펫) === */
  .backlink-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }

  .backlink-list li {
    margin: 0;
  }

  .row {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    border: 1px solid var(--accent-border);
    border-radius: var(--r-full);
    background: transparent;
    transition: background 0.15s, border-color 0.15s;
  }

  li.expanded .row {
    background: var(--accent-bg-subtle);
    border-color: var(--accent);
  }

  .chevron {
    background: transparent;
    border: none;
    color: var(--accent);
    cursor: pointer;
    padding: var(--sp-2) var(--sp-3) var(--sp-2) 10px;
    font-family: inherit;
    font-size: var(--fs-xs);
    line-height: 1;
    border-radius: var(--r-full) 0 0 var(--r-full);
  }

  .chevron:hover {
    background: var(--accent-bg-subtle);
    color: var(--text-primary);
  }

  .chip {
    background: transparent;
    border: none;
    color: var(--accent);
    padding: var(--sp-2) var(--sp-5);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--fs-sm);
    border-radius: var(--r-full);
    transition: background 0.15s, color 0.15s;
  }

  .row .chip {
    padding: var(--sp-2) var(--sp-5) var(--sp-2) var(--sp-2);
    border-radius: 0 var(--r-full) var(--r-full) 0;
  }

  .chip:hover {
    background: var(--accent-bg-subtle);
    color: var(--text-primary);
  }

  .snippet-box {
    margin-top: var(--sp-3);
    margin-left: 22px;
    padding: var(--sp-4) var(--sp-5);
    background: var(--surface-sunken);
    border-left: 2px solid var(--accent);
    border-radius: 0 var(--r-sm) var(--r-sm) 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }

  .snippet {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--fs-sm);
    line-height: 1.5;
  }

  .snippet.no-match {
    color: var(--text-muted);
    font-style: italic;
  }

  .placeholder {
    color: var(--text-muted);
    font-size: var(--fs-md);
    letter-spacing: 0.2em;
  }

  .open-link {
    align-self: flex-start;
    background: transparent;
    border: none;
    color: var(--accent);
    font-family: inherit;
    font-size: var(--fs-xs);
    padding: var(--sp-1) 0;
    cursor: pointer;
  }

  .open-link:hover {
    color: var(--text-primary);
    text-decoration: underline;
  }
</style>
