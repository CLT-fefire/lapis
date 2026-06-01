<script lang="ts">
  import { linkRewritePreviewRequest } from "$lib/stores/linkRewritePreview";

  const req = $derived($linkRewritePreviewRequest);

  function close(apply: boolean) {
    const r = $linkRewritePreviewRequest;
    if (!r) return;
    r.resolve(apply);
    linkRewritePreviewRequest.set(null);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close(false);
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if req}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={() => close(false)}>
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <header>
        <h2>링크 자동 갱신</h2>
        <button class="x" onclick={() => close(false)} aria-label="닫기">✕</button>
      </header>

      <p class="summary">
        <code>[[{req.preview.oldStem}]]</code> → <code>[[{req.preview.newStem}]]</code>
        <br />
        <strong>{req.preview.items.length}</strong>개 노트 ·
        총 <strong>{req.preview.totalOccurrences}</strong>건 인용 갱신 예정
      </p>

      <p class="hint">
        적용하면 원본은 <code>.lapis/link-rewrite-backup/&lt;timestamp&gt;/</code>에 백업됩니다.
        문제가 생기면 백업 폴더에서 수동 복구 가능.
      </p>

      <ul class="affected">
        {#each req.preview.items as item (item.path)}
          <li>
            <span class="path" title={item.path}>{item.path}</span>
            <span class="count">{item.occurrences}</span>
          </li>
        {/each}
      </ul>

      <footer>
        <button class="cancel" onclick={() => close(false)}>취소</button>
        <button class="apply" onclick={() => close(true)}>적용</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    background: var(--surface-overlay);
    color: var(--text-primary);
    border: 1px solid var(--border-default);
    border-radius: 8px;
    width: 560px;
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 80px);
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-overlay);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-default);
  }

  h2 {
    margin: 0;
    font-size: var(--fs-md);
    font-weight: 600;
  }

  .x {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    font-size: var(--fs-md);
    cursor: pointer;
    padding: 4px 8px;
  }
  .x:hover {
    color: var(--text-primary);
  }

  .summary {
    margin: 14px 18px 4px;
    font-size: var(--fs-base);
    line-height: 1.5;
  }

  .summary code {
    background: var(--surface-sunken);
    padding: 1px 6px;
    border-radius: 3px;
    font-family: "SF Mono", Menlo, Consolas, monospace;
    font-size: var(--fs-sm);
  }

  .hint {
    margin: 0 18px 10px;
    color: var(--text-muted);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }

  .hint code {
    background: var(--surface-sunken);
    padding: 1px 5px;
    border-radius: 3px;
    font-family: "SF Mono", Menlo, Consolas, monospace;
    font-size: 10px;
  }

  .affected {
    list-style: none;
    margin: 0;
    padding: 8px 18px;
    overflow: auto;
    flex: 1;
    min-height: 80px;
    max-height: 360px;
    border-top: 1px solid var(--border-subtle);
    border-bottom: 1px solid var(--border-subtle);
  }

  .affected li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 0;
    font-size: var(--fs-sm);
    border-bottom: 1px solid var(--border-subtle);
  }

  .affected li:last-child {
    border-bottom: none;
  }

  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
    font-family: "SF Mono", Menlo, Consolas, monospace;
    direction: rtl;
    text-align: left;
  }

  .count {
    flex-shrink: 0;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
    min-width: 32px;
    text-align: right;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 12px 18px;
  }

  footer button {
    padding: 6px 16px;
    border-radius: var(--r-sm);
    border: 1px solid var(--border-default);
    background: var(--surface-overlay);
    color: var(--text-primary);
    font-size: var(--fs-sm);
    cursor: pointer;
  }

  .cancel:hover {
    background: var(--border-default);
  }

  .apply {
    background: var(--accent-bg-subtle);
    border-color: var(--accent);
  }

  .apply:hover {
    background: var(--accent-border);
  }
</style>
