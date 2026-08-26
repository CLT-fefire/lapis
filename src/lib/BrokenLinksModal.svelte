<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import ModalShell from "$lib/ModalShell.svelte";
  import { brokenLinksOpen, closeBrokenLinks } from "$lib/stores/brokenLinks";
  import { linkIndex, selectNote } from "$lib/stores/vault";
  import { findBrokenLinks, countBrokenLinks } from "$lib/brokenLinks";

  /**
   * 열릴 때마다 인덱스에서 새로 뽑는다 — store에 캐시하지 않는 이유는
   * `stores/brokenLinks.ts` 주석 참조(무효화를 이중으로 두지 않는다).
   */
  const targets = $derived($brokenLinksOpen && $linkIndex ? findBrokenLinks($linkIndex) : []);
  const total = $derived(countBrokenLinks(targets));

  async function go(path: string) {
    closeBrokenLinks();
    await selectNote(path);
  }
</script>

{#if $brokenLinksOpen}
  <ModalShell onClose={closeBrokenLinks} label={m.brokenlinks_title()}>
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1">
      <header>
        <h2>{m.brokenlinks_title()}</h2>
        <button class="x" data-autofocus onclick={closeBrokenLinks} aria-label="✕">✕</button>
      </header>

      {#if !$linkIndex}
        <p class="empty">{m.brokenlinks_no_vault()}</p>
      {:else if targets.length === 0}
        <p class="empty">{m.brokenlinks_empty()}</p>
      {:else}
        <p class="summary">
          {m.brokenlinks_summary({ targets: targets.length, links: total })}
        </p>

        <ul class="targets">
          {#each targets as t (t.target)}
            <li>
              <div class="target">
                <code>[[{t.target}]]</code>
                <span class="count">{m.brokenlinks_referenced_by({ count: t.sources.length })}</span>
              </div>
              <ul class="sources">
                {#each t.sources as s (s.path)}
                  <li>
                    <button class="src" title={s.path} onclick={() => go(s.path)}>{s.name}</button>
                  </li>
                {/each}
              </ul>
            </li>
          {/each}
        </ul>
      {/if}

      <p class="hint">{m.brokenlinks_hint()}</p>
    </div>
  </ModalShell>
{/if}

<style>
  .modal {
    background: var(--surface-overlay);
    color: var(--text-primary);
    border: 1px solid var(--border-default);
    border-radius: var(--r-lg);
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
    gap: 12px;
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--border-subtle);
  }

  h2 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .x {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 0.9rem;
    padding: 2px 6px;
    border-radius: var(--r-sm);
  }
  .x:hover {
    background: var(--surface-raised);
    color: var(--text-primary);
  }

  .summary,
  .empty {
    margin: 0;
    padding: 12px 16px;
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  .targets {
    list-style: none;
    margin: 0;
    padding: 0 16px 8px;
    overflow-y: auto;
    flex: 1;
  }

  .targets > li {
    padding: 8px 0;
    border-top: 1px solid var(--border-subtle);
  }

  .target {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .target code {
    font-size: 0.85rem;
    color: var(--text-primary);
  }

  .count {
    font-size: 0.75rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .sources {
    list-style: none;
    margin: 4px 0 0;
    padding: 0 0 0 12px;
  }

  .src {
    background: none;
    border: none;
    padding: 2px 0;
    color: var(--text-secondary);
    font-size: 0.8rem;
    cursor: pointer;
    text-align: left;
  }
  .src:hover {
    color: var(--accent-fg);
    text-decoration: underline;
  }

  .hint {
    margin: 0;
    padding: 10px 16px 14px;
    border-top: 1px solid var(--border-subtle);
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.5;
  }
</style>
