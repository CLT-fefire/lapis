<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { pinnedNotePaths, removePin } from "$lib/stores/pins";
  import { recentNotePaths } from "$lib/stores/recent";
  import { currentNotePath, selectNote, linkIndex } from "$lib/stores/vault";
  import { noteStem, noteDisplayName } from "$lib/notePath";
  import { posFor, positions } from "$lib/stores/readingPos";
  import { readingMarkFor } from "$lib/readingMark";

  const RECENT_LIMIT = 8;

  // 현재 vault에 존재하는 path만 (linkIndex.byPath 기준) — 전역 핀/최근에서 깨진 항목 제거.
  function existing(paths: string[]): string[] {
    const idx = $linkIndex;
    if (!idx) return [];
    return paths.filter((p) => idx.byPath.has(p));
  }

  const pinned = $derived(existing($pinnedNotePaths));
  const recent = $derived(existing($recentNotePaths).slice(0, RECENT_LIMIT));

  /**
   * 읽던 자리 표식 — **최근 목록에만** 붙는다.
   *
   * ⚠️ 핀에는 안 붙인다. 핀은 "보관한 것"이지 "읽던 것"이 아니다.
   *
   * ⚠️ `$positions` 를 읽어 두는 이유는 **반응성** 때문이다. `posFor` 는 스토어를
   *    `get` 으로 한 번 보므로, 이걸 안 건드리면 자리가 바뀌어도 표식이 안 따라온다.
   */
  function markOf(path: string) {
    void $positions;
    return readingMarkFor(posFor(path));
  }

  function open(path: string) {
    if (path !== $currentNotePath) void selectNote(path, { via: "recent" });
  }

  function onUnpin(e: MouseEvent, path: string) {
    e.stopPropagation();
    removePin(path);
  }
</script>

<div class="favorites">
  <section class="group">
    <h3 class="group-title">{m.fav_title()}</h3>
    {#if pinned.length === 0}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    <p class="empty">{@html m.fav_empty()}</p>
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
              title={m.fav_unpin()}
              aria-label={m.fav_unpin()}
              onclick={(e) => onUnpin(e, path)}
            >✕</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if recent.length > 0}
    <section class="group">
      <h3 class="group-title">{m.fav_recent_title()}</h3>
      <ul class="list">
        {#each recent as path (path)}
          <!-- ⚠️ `{@const}` 는 `{#each}` 의 **바로 아래**여야 한다 — 버튼 안에 두면
               컴파일이 안 된다. -->
          {@const mark = markOf(path)}
          <li>
            <button
              class="item"
              class:active={path === $currentNotePath}
              title={path}
              onclick={() => open(path)}
            >
              <!-- ⚠️ 라벨과 표식을 한 줄에 둔다. `.item` 이 세로 배치라 그냥 넣으면
                   표식이 아래로 떨어진다. -->
              <span class="row">
                <span class="label">{noteStem(path)}</span>
                {#if mark}
                  <span
                    class="mark"
                    class:mark--line={mark.kind === "editor"}
                    title={mark.kind === "editor"
                      ? m.fav_reading_line({ line: String(mark.line) })
                      : m.fav_reading_mark()}
                  >
                    {mark.kind === "editor" ? mark.line : "•"}
                  </span>
                {/if}
              </span>
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
    letter-spacing: 0.01em;
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

  /* 라벨과 표식을 한 줄에 — `.item` 이 세로 배치라 감싸 준다. */
  .row {
    display: flex;
    align-items: baseline;
    gap: var(--sp-1);
    width: 100%;
    min-width: 0;
  }

  .row .label {
    flex: 1;
    min-width: 0;
  }

  /**
   * 읽던 자리 표식.
   *
   * ⚠️ 색을 하드코딩하지 않는다 — 테마 3종이 `app.css` 의 토큰에서 갈린다.
   */
  .mark {
    flex-shrink: 0;
    font-size: var(--fs-xs);
    color: var(--text-muted);
    line-height: 1;
    opacity: 0.75;
  }

  /* 줄 번호는 점보다 넓다 — 숫자꼴을 고정해 목록이 들쭉날쭉하지 않게. */
  .mark--line {
    font-variant-numeric: tabular-nums;
    padding: 0 var(--sp-1);
    border-radius: var(--r-sm);
    background: var(--surface-sunken);
  }

  .item:hover .mark,
  .item.active .mark {
    opacity: 1;
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
