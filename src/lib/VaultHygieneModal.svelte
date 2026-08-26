<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import ModalShell from "$lib/ModalShell.svelte";
  import { brokenLinksOpen, closeBrokenLinks } from "$lib/stores/brokenLinks";
  import { linkIndex, selectNote } from "$lib/stores/vault";
  import { findBrokenLinks, countBrokenLinks } from "$lib/brokenLinks";
  import { findOrphans, findTagIssues, findAmbiguousNames, type TagIssueKind } from "$lib/vaultAudit";

  /**
   * vault 위생 — 끊긴 링크 · 고아 노트 · 태그 중복을 한 화면에 모은다.
   *
   * 셋을 따로 두지 않는 이유: 전부 "vault를 정비하려고 여는" 화면이고, 팔레트 항목을
   * 셋으로 늘리면 자주 안 쓰는 것이 목록을 셋이나 차지한다.
   *
   * ## ⚠️ 판단하지 않는다
   *
   * 고치라고 하지 않고 **보여주기만** 한다. 되돌릴 수 없는 실행은 태그 이름 바꾸기가
   * 맡고, 그건 미리보기 → 백업 → 롤백을 거친다. 감사가 오탐을 섞어 권하면 목록 자체를
   * 안 믿게 된다.
   *
   * ## 열 때마다 새로 뽑는다
   *
   * 결과를 store에 캐시하지 않는다 — `stores/brokenLinks.ts` 주석 참조. 무효화를 이중으로
   * 두면 인덱스 재빌드 경로와 어긋날 여지만 는다.
   */

  type Tab = "broken" | "orphans" | "tags";
  let tab = $state<Tab>("broken");

  const idx = $derived($brokenLinksOpen ? $linkIndex : null);
  const targets = $derived(idx ? findBrokenLinks(idx) : []);
  const brokenTotal = $derived(countBrokenLinks(targets));
  const orphans = $derived(idx ? findOrphans(idx) : []);
  const tagIssues = $derived(idx ? findTagIssues([...idx.byPath.values()]) : []);
  const ambiguous = $derived(idx ? findAmbiguousNames(idx) : []);

  const TAG_LABEL: Record<TagIssueKind, () => string> = {
    "same-leaf": () => m.hygiene_tags_same_leaf(),
    "case-only": () => m.hygiene_tags_case_only(),
    "near-universal": () => m.hygiene_tags_near_universal(),
  };

  /** 탭 옆의 숫자 — 열기 전에 어디를 봐야 할지 알려준다. */
  const counts = $derived({
    broken: targets.length,
    orphans: orphans.length,
    tags: tagIssues.length + ambiguous.length,
  });

  async function go(path: string) {
    closeBrokenLinks();
    await selectNote(path);
  }

  function shortName(path: string): string {
    return path.split("/").pop()?.replace(/\.md$/i, "") ?? path;
  }
</script>

{#if $brokenLinksOpen}
  <ModalShell onClose={closeBrokenLinks} label={m.hygiene_title()}>
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1">
      <header>
        <h2>{m.hygiene_title()}</h2>
        <button class="x" data-autofocus onclick={closeBrokenLinks} aria-label="✕">✕</button>
      </header>

      {#if !idx}
        <p class="empty">{m.brokenlinks_no_vault()}</p>
      {:else}
        <div class="tabs" role="tablist">
          {#each [["broken", m.hygiene_tab_broken()], ["orphans", m.hygiene_tab_orphans()], ["tags", m.hygiene_tab_tags()]] as const as [id, label] (id)}
            <button
              role="tab"
              class="tab"
              class:active={tab === id}
              aria-selected={tab === id}
              onclick={() => (tab = id as Tab)}
            >
              {label}
              <span class="badge">{counts[id as Tab]}</span>
            </button>
          {/each}
        </div>

        {#if tab === "broken"}
          {#if targets.length === 0}
            <p class="empty">{m.brokenlinks_empty()}</p>
          {:else}
            <p class="summary">
              {m.brokenlinks_summary({ targets: targets.length, links: brokenTotal })}
            </p>
            <ul class="targets">
              {#each targets as t (t.target)}
                <li>
                  <div class="target">
                    <code>[[{t.target}]]</code>
                    <span class="count">
                      {m.brokenlinks_referenced_by({ count: t.sources.length })}
                    </span>
                  </div>
                  <ul class="sources">
                    {#each t.sources as s (s.path)}
                      <li>
                        <button class="src" title={s.path} onclick={() => go(s.path)}>
                          {s.name}
                        </button>
                      </li>
                    {/each}
                  </ul>
                </li>
              {/each}
            </ul>
          {/if}
          <p class="hint">{m.brokenlinks_hint()}</p>
        {:else if tab === "orphans"}
          {#if orphans.length === 0}
            <p class="empty">{m.hygiene_orphans_empty()}</p>
          {:else}
            <p class="summary">{m.hygiene_orphans_summary({ count: orphans.length })}</p>
            <ul class="rows">
              {#each orphans as o (o.path)}
                <li>
                  <button class="src" title={o.path} onclick={() => go(o.path)}>{o.name}</button>
                  <span class="count">{m.hygiene_orphans_outgoing({ count: o.outgoing })}</span>
                </li>
              {/each}
            </ul>
          {/if}
          <p class="hint">{m.hygiene_orphans_hint()}</p>
        {:else}
          {#if tagIssues.length === 0 && ambiguous.length === 0}
            <p class="empty">{m.hygiene_tags_empty()}</p>
          {:else}
            {#each tagIssues as issue, i (issue.kind + i)}
              <div class="group">
                <div class="group-label">{TAG_LABEL[issue.kind]()}</div>
                <div class="chips">
                  {#each issue.tags as t (t.tag)}
                    <span class="chip">{t.tag}<span class="count">{t.count}</span></span>
                  {/each}
                </div>
              </div>
            {/each}
            {#if ambiguous.length > 0}
              <div class="group">
                <div class="group-label">{m.hygiene_ambiguous()}</div>
                <ul class="targets">
                  {#each ambiguous as a (a.name)}
                    <li>
                      <div class="target">
                        <code>{a.name}</code>
                        <span class="count">
                          {m.hygiene_ambiguous_count({ count: a.paths.length })}
                        </span>
                      </div>
                      <ul class="sources">
                        {#each a.paths as p (p)}
                          <li>
                            <button class="src" title={p} onclick={() => go(p)}>
                              {shortName(p)}
                            </button>
                          </li>
                        {/each}
                      </ul>
                    </li>
                  {/each}
                </ul>
                <p class="hint">{m.hygiene_ambiguous_hint()}</p>
              </div>
            {/if}
          {/if}
          <p class="hint">{m.hygiene_tags_hint()}</p>
        {/if}
      {/if}
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

  /* 탭 — 셋을 한 화면에 모았으니 어디에 무엇이 있는지 숫자로 보인다. */
  .tabs {
    display: flex;
    gap: 2px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 8px 10px;
    color: var(--text-secondary);
    font-size: 0.8rem;
    cursor: pointer;
  }
  .tab:hover {
    color: var(--text-primary);
  }
  .tab.active {
    color: var(--text-primary);
    border-bottom-color: var(--accent);
  }

  .badge {
    padding: 0 5px;
    border-radius: var(--r-sm);
    background: var(--surface-raised);
    color: var(--text-muted);
    font-size: 0.7rem;
  }

  /* 고아 목록 — 이름과 '나가는 링크 수'를 나란히. 그 숫자가 허브를 가른다. */
  .rows {
    list-style: none;
    margin: 0;
    padding: 0 16px 8px;
    overflow-y: auto;
    flex: 1;
  }
  .rows > li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
    border-top: 1px solid var(--border-subtle);
  }

  .group {
    padding: 10px 16px 0;
  }
  .group-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 6px;
  }
  .group .targets,
  .group .hint {
    padding-left: 0;
    padding-right: 0;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    padding: 3px 8px;
    border-radius: var(--r-sm);
    background: var(--surface-raised);
    color: var(--text-primary);
    font-size: 0.8rem;
  }
</style>
