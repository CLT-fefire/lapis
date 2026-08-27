<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import ModalShell from "$lib/ModalShell.svelte";
  import {
    brokenLinksOpen,
    closeBrokenLinks,
    hygieneInitialTab,
  } from "$lib/stores/brokenLinks";
  import { linkIndex, selectNote, vaultPath } from "$lib/stores/vault";
  import { readVaultBundle } from "$lib/tauri/notes";
  import { findBrokenLinks, countBrokenLinks } from "$lib/brokenLinks";
  import {
    findOrphans,
    findTagIssues,
    findAmbiguousNames,
    findUnlinkedMentions,
    findFrontmatterIssues,
    type TagIssueKind,
    type FrontmatterIssueKind,
    type UnlinkedMention,
  } from "$lib/vaultAudit";

  /**
   * vault 위생 — 끊긴 링크 · 고아 노트 · 태그 중복 · 안 걸린 언급을 한 화면에 모은다.
   *
   * 따로 두지 않는 이유: 전부 "vault를 정비하려고 여는" 화면이고, 팔레트 항목을 넷으로
   * 늘리면 자주 안 쓰는 것이 목록을 넷이나 차지한다.
   *
   * 네 감사는 같은 그래프를 각기 다른 각도에서 본다 — 가리켰는데 없다 · 아무도 안
   * 가리킨다 · 이름이 갈린다 · **말했는데 안 가리킨다.**
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

  type Tab = "broken" | "orphans" | "tags" | "unlinked" | "props";
  let tab = $state<Tab>("broken");

  // 열릴 때 팔레트가 지정한 탭으로 간다. ⚠️ **열릴 때만** — 열려 있는 동안 store 가
  //    바뀌어도 사용자가 고른 탭을 빼앗지 않는다.
  $effect(() => {
    if ($brokenLinksOpen) tab = $hygieneInitialTab;
  });

  /**
   * ⚠️ 넷째 탭만 **본문**이 있어야 한다. 나머지 셋은 인덱스만으로 되고, 앱은 본문을
   * 들고 있지 않다(기동 때 인덱스를 짓고 버린다). 그래서 이 탭은 열 때 한 번 읽는다.
   *
   * `null`은 "아직 안 셌다"이고 `[]`는 "세었더니 없다"이다. 둘을 합치면 배지가 0을
   * 띄우는데, 그건 **아무것도 안 봤으면서 깨끗하다고 말하는 것**이다.
   */
  let unlinked = $state<UnlinkedMention[] | null>(null);
  let unlinkedBusy = $state(false);
  let unlinkedFailed = $state(false);

  const idx = $derived($brokenLinksOpen ? $linkIndex : null);
  const targets = $derived(idx ? findBrokenLinks(idx) : []);
  const brokenTotal = $derived(countBrokenLinks(targets));
  const orphans = $derived(idx ? findOrphans(idx) : []);
  const tagIssues = $derived(idx ? findTagIssues([...idx.byPath.values()]) : []);
  const ambiguous = $derived(idx ? findAmbiguousNames(idx) : []);
  const fmIssues = $derived(idx ? findFrontmatterIssues(idx) : []);

  // 모달을 닫으면 버린다 — 다음에 열 때 vault가 그대로라는 보장이 없다.
  // 감사 셋이 캐시를 안 두는 것과 같은 이유다(무효화 경로를 둘로 만들지 않는다).
  $effect(() => {
    if (!$brokenLinksOpen) {
      unlinked = null;
      unlinkedFailed = false;
    }
  });

  $effect(() => {
    if (tab === "unlinked" && unlinked === null && !unlinkedBusy && !unlinkedFailed) {
      void loadUnlinked();
    }
  });

  async function loadUnlinked(): Promise<void> {
    const root = $vaultPath;
    const index = $linkIndex;
    if (!root || !index) return;
    unlinkedBusy = true;
    try {
      const bundle = await readVaultBundle(root);
      const bodies = new Map(bundle.contents.map((c) => [c.path, c.body]));
      unlinked = findUnlinkedMentions(index, bodies);
    } catch {
      // 읽기 실패를 빈 목록으로 삼키면 "깨끗하다"로 보인다.
      unlinkedFailed = true;
    } finally {
      unlinkedBusy = false;
    }
  }

  const FM_LABEL: Record<FrontmatterIssueKind, () => string> = {
    "case-only": () => m.hygiene_props_case_only(),
    plural: () => m.hygiene_props_plural(),
    prefix: () => m.hygiene_props_prefix(),
  };

  const TAG_LABEL: Record<TagIssueKind, () => string> = {
    "same-leaf": () => m.hygiene_tags_same_leaf(),
    "case-only": () => m.hygiene_tags_case_only(),
    "near-universal": () => m.hygiene_tags_near_universal(),
  };

  /** 탭 옆의 숫자 — 열기 전에 어디를 봐야 할지 알려준다. */
  const counts = $derived<Record<Tab, number | null>>({
    broken: targets.length,
    orphans: orphans.length,
    tags: tagIssues.length + ambiguous.length,
    // null = 아직 안 셌다. 0을 띄우면 안 본 것을 깨끗하다고 말하게 된다.
    unlinked: unlinked === null ? null : unlinked.length,
    props: fmIssues.length,
  });

  const TABS = $derived<[Tab, string][]>([
    ["broken", m.hygiene_tab_broken()],
    ["orphans", m.hygiene_tab_orphans()],
    ["tags", m.hygiene_tab_tags()],
    ["unlinked", m.hygiene_tab_unlinked()],
    ["props", m.hygiene_tab_props()],
  ]);

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
          {#each TABS as [id, label] (id)}
            <button
              role="tab"
              class="tab"
              class:active={tab === id}
              aria-selected={tab === id}
              onclick={() => (tab = id)}
            >
              {label}
              <!-- 안 센 것은 0이 아니라 – 로 — 0은 "봤는데 없다"는 뜻이다. -->
              <span class="badge">{counts[id] ?? "–"}</span>
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
        {:else if tab === "tags"}
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
        {:else if tab === "unlinked"}
          {#if unlinkedBusy}
            <!-- `loading` 은 테스트가 "읽는 중"과 "읽었더니 없다"를 문구 없이 가르는 표식이다. -->
            <p class="empty loading">{m.hygiene_unlinked_loading()}</p>
          {:else if unlinkedFailed}
            <p class="empty">{m.hygiene_unlinked_failed()}</p>
          {:else if unlinked !== null && unlinked.length === 0}
            <p class="empty">{m.hygiene_unlinked_empty()}</p>
          {:else if unlinked !== null}
            <p class="summary">
              {m.hygiene_unlinked_summary({
                names: unlinked.length,
                mentions: unlinked.reduce((n, r) => n + r.total, 0),
              })}
            </p>
            <ul class="targets">
              {#each unlinked as u (u.target + "|" + u.name)}
                <li>
                  <div class="target">
                    <button class="src" title={u.target} onclick={() => go(u.target)}>
                      {u.name}
                    </button>
                    <span class="count">{m.hygiene_unlinked_where({ count: u.total })}</span>
                  </div>
                  <ul class="sources">
                    {#each u.sources as s (s.path)}
                      <li>
                        <button class="src" title={s.path} onclick={() => go(s.path)}>
                          {s.name}:{s.line}
                        </button>
                        <!-- 미리보기가 있어야 진짜 그 노트를 말한 건지 판단할 수 있다. -->
                        <span class="preview">{s.preview}</span>
                      </li>
                    {/each}
                  </ul>
                </li>
              {/each}
            </ul>
          {/if}
          <p class="hint">{m.hygiene_unlinked_hint()}</p>
        {:else}
          {#if fmIssues.length === 0}
            <p class="empty">{m.hygiene_props_empty()}</p>
          {:else}
            {#each fmIssues as issue, i (issue.field + issue.kind + i)}
              <div class="group">
                <div class="group-label">{issue.field} · {FM_LABEL[issue.kind]()}</div>
                <ul class="rows">
                  {#each issue.values as v (v.value)}
                    <li>
                      <span class="value">{v.value}</span>
                      <span class="count">{v.count}</span>
                    </li>
                  {/each}
                </ul>
              </div>
            {/each}
          {/if}
          <p class="hint">{m.hygiene_props_hint()}</p>
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

  /* 미리보기 — 한 줄로 자른다. 여러 줄이 되면 목록이 훑기 어려워진다. */
  /* 값은 자유 서술이 섞여 길 수 있다 — 자르지 않고 접는다. 잘라내면 왜 걸렸는지가 안 보인다. */
  .value {
    overflow-wrap: anywhere;
  }

  .preview {
    display: block;
    font-size: 0.75rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
    /* 탭이 다섯이라 560px에서 넘칠 수 있다. 줄이지 말고 접는다 — 줄이면 라벨이 잘린다. */
    flex-wrap: wrap;
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
