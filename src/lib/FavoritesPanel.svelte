<script lang="ts">
  import { pinnedNotePaths, removePin } from "$lib/stores/pins";
  import { recentNotePaths } from "$lib/stores/recent";
  import { currentNotePath, selectNote, linkIndex } from "$lib/stores/vault";
  import { noteStem, noteDisplayName } from "$lib/notePath";

  const RECENT_LIMIT = 8;

  // 현재 vault에 존재하는 path만 (linkIndex.byPath 기준) — 전역 핀/최근에서 깨진 항목 제거.
  function existing(paths: string[]): string[] {
    const idx = $linkIndex;
    if (!idx) return [];
    return paths.filter((p) => idx.byPath.has(p));
  }

  const pinned = $derived(existing($pinnedNotePaths));
  const recent = $derived(existing($recentNotePaths).slice(0, RECENT_LIMIT));

  function open(path: string) {
    if (path !== $currentNotePath) void selectNote(path);
  }

  function onUnpin(e: MouseEvent, path: string) {
    e.stopPropagation();
    removePin(path);
  }
</script>

<div class="favorites">
  <section class="group">
    <h3 class="group-title">⭐ 즐겨찾기</h3>
    {#if pinned.length === 0}
      <p class="empty">파일을 우클릭 → <strong>📌 Pin</strong>으로 추가하세요.</p>
    {:else}
      <ul class="list">
        {#each pinned as path (path)}
          <li>
            <button
              class="item"
              class:active={path === $currentNotePath}
              title={path}
              onclick={() => open(path)}
            >
              <span class="label">{noteStem(path)}</span>
              <span class="sub">{noteDisplayName(path)}</span>
            </button>
            <button
              class="btn btn--icon btn--sm btn--plain unpin"
              title="즐겨찾기 해제"
              aria-label="즐겨찾기 해제"
              onclick={(e) => onUnpin(e, path)}
            >✕</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if recent.length > 0}
    <section class="group">
      <h3 class="group-title">🕘 최근</h3>
      <ul class="list">
        {#each recent as path (path)}
          <li>
            <button
              class="item"
              class:active={path === $currentNotePath}
              title={path}
              onclick={() => open(path)}
            >
              <span class="label">{noteStem(path)}</span>
              <span class="sub">{noteDisplayName(path)}</span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .favorites {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
    padding: var(--sp-3);
    overflow-y: auto;
  }

  .group-title {
    margin: 0 0 var(--sp-2);
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .empty {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--text-muted);
    line-height: 1.5;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .list li {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
  }

  .item {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    padding: var(--sp-2) var(--sp-2);
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    color: var(--text-secondary);
    cursor: pointer;
    text-align: left;
  }

  .item:hover {
    background: var(--surface-sunken);
    color: var(--text-primary);
  }

  .item.active {
    background: var(--accent-bg-subtle);
    color: var(--text-primary);
  }

  .item .label {
    font-size: var(--fs-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  .item .sub {
    font-size: var(--fs-xs);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  .unpin {
    flex-shrink: 0;
    font-size: var(--fs-xs);
    opacity: 0.5;
  }

  .unpin:hover {
    opacity: 1;
  }
</style>
