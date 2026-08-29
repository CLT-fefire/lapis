<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { noteStem } from "$lib/notePath";
  import { findStaleNotes } from "$lib/staleNotes";
  import { mtimeOf } from "$lib/stores/mtimes";
  import { parseFrontmatterDate } from "$lib/recency";
  import { get } from "svelte/store";
  import { applySearch } from "$lib/stores/inDocSearch";
  import { mainPane } from "$lib/stores/layout";
  import { newNoteRequest } from "$lib/stores/tree-ui";
  import { collectOpenTasks, countOpenTasks, type OpenTaskGroup } from "$lib/openTasks";
  import { gitRecent, type GitCommit } from "$lib/tauri/git";
  import { gitRepo, formatCommitDate } from "$lib/stores/git";
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
   * vault 진단 — 끊긴 링크 · 백링크 없음 · 태그 중복 · 안 걸린 언급을 한 화면에 모은다.
   *
   * ⚠️ 파일 이름과 식별자는 `Hygiene`/`orphan` 그대로다. 화면 용어만 바뀌었고 그 이유는
   * `vaultAudit.ts` 머리에 적혀 있다(`--orphans` 가 API 라서).
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

  type Tab = "broken" | "orphans" | "tags" | "unlinked" | "props" | "tasks" | "changes" | "stale";
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

  /**
   * 미완 작업 — `unlinked` 와 같은 부류다. 인덱스로는 안 되고 **본문을 읽어야** 한다.
   * 그래서 탭을 열 때만 돈다(`audit: all` 이 없는 것과 같은 이유).
   */
  let tasks = $state<OpenTaskGroup[] | null>(null);
  let tasksBusy = $state(false);
  let tasksFailed = $state(false);

  /**
   * vault 전체의 최근 커밋 — "오늘 뭐가 바뀌었나".
   *
   * ⚠️ 노트별 이력(컨텍스트 패널의 관계 탭)과 **다른 질문**이다. 저쪽은 한 노트를
   * 따라가고 이쪽은 하루를 조망한다.
   */
  let changes = $state<GitCommit[] | null>(null);
  let changesBusy = $state(false);

  const idx = $derived($brokenLinksOpen ? $linkIndex : null);
  const targets = $derived(idx ? findBrokenLinks(idx) : []);
  const brokenTotal = $derived(countBrokenLinks(targets));
  const orphans = $derived(idx ? findOrphans(idx) : []);
  const tagIssues = $derived(idx ? findTagIssues([...idx.byPath.values()]) : []);
  const ambiguous = $derived(idx ? findAmbiguousNames(idx) : []);
  const fmIssues = $derived(idx ? findFrontmatterIssues(idx) : []);

  /**
   * 오래 안 건드린 노트.
   *
   * ⚠️ **인덱스만으로 된다** — `mtimes` 지도와 frontmatter `date` 가 이미 있다.
   *    본문을 안 읽으므로 탭을 열 때 기다릴 것이 없다.
   *
   * ⚠️ `Date.now()` 를 여기서 읽는다. 판정은 `findStaleNotes` 가 하고 시계는 화면이 준다 —
   *    그래야 그 함수가 테스트 가능하다.
   */
  const stale = $derived(
    idx
      ? findStaleNotes(
          [...idx.byPath.values()].map((i) => ({
            path: i.source_path,
            mtimeMs: mtimeOf(i.source_path),
            // ⚠️ parseFrontmatterDate 는 문자열만 받는다 — 없는 값을 넘기면 죽는다.
            dateMs: i.props?.date?.[0] ? parseFrontmatterDate(i.props.date[0]) : null,
          })),
          Date.now(),
        )
      : [],
  );

  // 모달을 닫으면 버린다 — 다음에 열 때 vault가 그대로라는 보장이 없다.
  // 감사 셋이 캐시를 안 두는 것과 같은 이유다(무효화 경로를 둘로 만들지 않는다).
  $effect(() => {
    if (!$brokenLinksOpen) {
      unlinked = null;
      unlinkedFailed = false;
      tasks = null;
      tasksFailed = false;
    }
  });

  $effect(() => {
    if (tab === "unlinked" && unlinked === null && !unlinkedBusy && !unlinkedFailed) {
      void loadUnlinked();
    }
    if (tab === "tasks" && tasks === null && !tasksBusy && !tasksFailed) {
      void loadTasks();
    }
    if (tab === "changes" && changes === null && !changesBusy) {
      void loadChanges();
    }
  });

  async function loadChanges(): Promise<void> {
    const root = $vaultPath;
    if (!root || !$gitRepo) {
      // ⚠️ repo 가 아니면 **빈 목록**이지 실패가 아니다. 화면이 그 둘을 다르게 말한다.
      changes = [];
      return;
    }
    changesBusy = true;
    try {
      changes = await gitRecent(root, 30);
    } catch {
      changes = [];
    } finally {
      changesBusy = false;
    }
  }

  async function loadTasks(): Promise<void> {
    const root = $vaultPath;
    if (!root) return;
    tasksBusy = true;
    try {
      const bundle = await readVaultBundle(root);
      tasks = collectOpenTasks(bundle.contents.map((c) => ({ path: c.path, body: c.body })));
    } catch {
      // ⚠️ 읽기 실패를 빈 목록으로 삼키면 "할 일이 없다"로 보인다.
      tasksFailed = true;
    } finally {
      tasksBusy = false;
    }
  }

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
    suffix: () => m.hygiene_props_suffix(),
    sparse: () => m.hygiene_props_sparse(),
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
    // null = 아직 안 셌다. 0 을 띄우면 안 본 것을 "할 일 없음"이라고 말하게 된다.
    tasks: tasks === null ? null : countOpenTasks(tasks).open,
    changes: changes === null ? null : changes.length,
    stale: stale.length,
  });

  /**
   * 좌측 목록 — **무엇에서 나온 감사인가**로 묶는다.
   *
   * 가로 탭 다섯은 순서 말고는 아무 관계도 말하지 않았다. 다섯이 나란히 있으면 읽는
   * 사람이 "이것들이 다 같은 종류구나" 하고 읽는데, 실제로는 두 종류다.
   *
   * - **그래프에서** — 링크가 만든 구조를 보는 넷. 끊긴 링크 · 고아 · 태그 · 안 걸린 언급
   * - **거를 수 있는 축** — 프론트매터. `stores/filters.ts` 가 거르는 것이 정확히 이것
   *   (doc_kind · topic)이라, 이 감사는 "거르기가 제대로 되나"를 묻는다
   */
  const TAB_GROUPS = $derived<{ label: string; tabs: [Tab, string][] }[]>([
    {
      label: m.hygiene_group_graph(),
      tabs: [
        ["broken", m.hygiene_tab_broken()],
        ["orphans", m.hygiene_tab_orphans()],
        ["tags", m.hygiene_tab_tags()],
        ["unlinked", m.hygiene_tab_unlinked()],
      ],
    },
    {
      label: m.hygiene_group_axis(),
      tabs: [["props", m.hygiene_tab_props()]],
    },
    {
      // ⚠️ 앞의 다섯은 **구조**를 본다(링크·축). 이건 **본문에 적힌 것**을 본다 —
      //    묶음을 나눠 두지 않으면 "왜 여기 있지"가 된다.
      label: m.hygiene_group_body(),
      tabs: [["tasks", m.hygiene_tab_tasks()]],
    },
    {
      // 나머지는 vault 의 **지금**을 본다. 이건 **지나온 것**을 본다.
      label: m.hygiene_group_history(),
      tabs: [
        ["changes", m.hygiene_tab_changes()],
        ["stale", m.hygiene_tab_stale()],
      ],
    },
  ]);

  async function go(path: string) {
    closeBrokenLinks();
    await selectNote(path, { via: "search" });
  }

  /**
   * 🔴 **찾아 놓고 데려다주지 않으면 절반이다.**
   *
   * `OpenTask` 는 `line` 을 담고 있는데 예전엔 파일까지만 갔다 — 90건짜리 노트에서
   * 그 줄을 다시 손으로 찾아야 했다.
   *
   * ⚠️ 줄 번호로 스크롤하지 않고 **문서 내 검색으로 넘긴다.** 렌더된 본문에는 원문
   * 줄 번호가 없다(코드 블록·표·트랜스클루전이 줄 수를 바꾼다). `grep` 결과에서
   * 노트로 넘어갈 때 쓰는 것과 **같은 기계**다.
   *
   * ⚠️ 정규식이 아니라 **리터럴**로 넘긴다. 작업 문장에 `(`·`*` 가 들어 있으면
   * 정규식으로는 안 맞거나 죽는다.
   */
  async function goToTask(path: string, text: string) {
    closeBrokenLinks();
    await selectNote(path, { via: "search" });
    applySearch(
      text,
      { regex: false, caseSensitive: false, wholeWord: false },
      get(mainPane) === "editor" ? "editor" : "preview",
    );
  }

  /**
   * 🔴 **끊긴 링크에서 그 노트를 만든다.**
   *
   * 찾아 놓고 "직접 만드세요"로 끝내면, 정작 만들 때 이름을 다시 옮겨 적어야 한다.
   * 새 노트 모달과 템플릿은 이미 있다 — **그 자리에 잇는 것**뿐이다.
   *
   * ⚠️ 어느 폴더에 만들지는 **거는 쪽 노트의 폴더**로 둔다. vault 루트에 만들면
   * 구조가 무너지고, 물어보면 흐름이 끊긴다. 모달에서 바꿀 수 있다.
   */
  function createMissing(target: string, fromPath: string) {
    const dir = fromPath.slice(0, fromPath.lastIndexOf("/"));
    closeBrokenLinks();
    newNoteRequest.set({ parentDir: dir, parentLabel: noteStem(dir), suggestedName: target });
  }

  function shortName(path: string): string {
    return noteStem(path);
  }
</script>

{#if $brokenLinksOpen}
  <ModalShell onClose={closeBrokenLinks} label={m.hygiene_title()}>
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1">
      <header>
        <h2>{m.hygiene_title()}</h2>
        <button class="x" data-autofocus onclick={closeBrokenLinks} aria-label={m.modal_close()}>✕</button>
      </header>

      {#if !idx}
        <p class="empty">{m.brokenlinks_no_vault()}</p>
      {:else}
        <div class="split">
        <div class="tabs" role="tablist" aria-label={m.hygiene_title()}>
          {#each TAB_GROUPS as group (group.label)}
            <div class="tab-group-label">{group.label}</div>
            {#each group.tabs as [id, label] (id)}
              <button
                role="tab"
                class="tab"
                class:active={tab === id}
                aria-selected={tab === id}
                onclick={() => (tab = id)}
              >
                <span class="tab-label">{label}</span>
                <!-- 안 센 것은 0이 아니라 – 로 — 0은 "봤는데 없다"는 뜻이다. -->
                <span class="badge">{counts[id] ?? "–"}</span>
              </button>
            {/each}
          {/each}
        </div>

        <div class="pane">
        {#if tab === "stale"}
          {#if stale.length === 0}
            <p class="empty">{m.hygiene_stale_empty()}</p>
          {:else}
            <p class="summary">{m.hygiene_stale_summary({ count: stale.length })}</p>
            <ul class="rows">
              {#each stale.slice(0, 100) as n (n.path)}
                <li class="stale-row">
                  <button class="src" title={n.path} onclick={() => go(n.path)}>
                    {shortName(n.path)}
                  </button>
                  <span class="count">{m.hygiene_stale_days({ days: n.days })}</span>
                </li>
              {/each}
            </ul>
          {/if}
          <p class="hint">{m.hygiene_stale_hint()}</p>
        {:else if tab === "broken"}
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
                    <!--
                      🔴 찾아 놓고 "직접 만드세요"로 끝내면 이름을 다시 옮겨 적어야 한다.
                      새 노트 모달과 템플릿은 이미 있다 — 그 자리에 잇는 것뿐이다.
                    -->
                    <button
                      class="make"
                      onclick={() => createMissing(t.target, t.sources[0]?.path ?? "")}
                    >
                      {m.brokenlinks_create()}
                    </button>
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
        <!-- ⚠️ 명시 분기다. `{:else}` 로 두면 뒤에 탭을 더할 수 없다. -->
        {:else if tab === "props"}
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
                  <!-- ⚠️ 자른 것을 **말한다.** 조용히 자르면 "이게 전부"로 읽힌다. -->
                  {#if issue.total}
                    <li class="more">
                      {m.hygiene_props_more({ count: issue.total - issue.values.length })}
                    </li>
                  {/if}
                </ul>
              </div>
            {/each}
          {/if}
          <p class="hint">{m.hygiene_props_hint()}</p>
        {:else if tab === "tasks"}
          {#if tasksBusy}
            <!-- `loading` 은 "읽는 중"과 "읽었더니 없다"를 문구 없이 가르는 표식이다. -->
            <p class="empty loading">{m.hygiene_tasks_loading()}</p>
          {:else if tasksFailed}
            <p class="empty">{m.hygiene_tasks_failed()}</p>
          {:else if tasks !== null && tasks.length === 0}
            <p class="empty">{m.hygiene_tasks_empty()}</p>
          {:else if tasks !== null}
            <p class="summary">
              {m.hygiene_tasks_summary({
                open: countOpenTasks(tasks).open,
                done: countOpenTasks(tasks).done,
              })}
            </p>
            {#each tasks as g (g.path)}
              <div class="group">
                <div class="group-label">
                  <button class="src" title={g.path} onclick={() => go(g.path)}>
                    {shortName(g.path)}
                  </button>
                  <span class="count">{m.hygiene_tasks_in({ count: g.open.length })}</span>
                </div>
                <ul class="rows">
                  {#each g.open as t (t.line)}
                    <li class="task-row" style="--task-depth: {t.depth}">
                      <button class="task-jump" onclick={() => goToTask(g.path, t.text)}>
                        {t.text}
                      </button>
                    </li>
                  {/each}
                </ul>
              </div>
            {/each}
          {/if}
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          <p class="hint">{@html m.hygiene_tasks_hint()}</p>
        {:else if tab === "changes"}
          {#if changesBusy}
            <p class="empty loading">{m.hygiene_tasks_loading()}</p>
          {:else if !$gitRepo}
            <p class="empty">{m.hygiene_changes_norepo()}</p>
          {:else if changes !== null && changes.length === 0}
            <p class="empty">{m.hygiene_changes_empty()}</p>
          {:else if changes !== null}
            <ul class="rows">
              {#each changes as c (c.hash)}
                <li>
                  <span class="value">{c.subject}</span>
                  <span class="count">{formatCommitDate(c.timestamp)}</span>
                </li>
              {/each}
            </ul>
          {/if}
          <p class="hint">{m.hygiene_changes_hint()}</p>
        {/if}
        </div>
        </div>
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
    /* 좌측 목록이 생기면서 본문 폭이 그만큼 줄었다 — 감사 표는 원래도 560px 에서
       빠듯했다. `--modal-w-xl` 이 그 자리를 위해 있는 토큰이다. */
    width: var(--modal-w-xl, 680px);
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

  /**
   * 좌측 목록 + 본문.
   *
   * ⚠️ `min-height: 0` 두 곳 — 없으면 긴 표가 모달을 밀어내고 화면 밖으로 나간다.
   * 스크롤은 본문(`.pane`) 안에서 일어나야 한다.
   */
  .split {
    display: grid;
    grid-template-columns: 176px 1fr;
    flex: 1;
    min-height: 0;
  }

  .pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
    border-left: 1px solid var(--border-subtle);
  }

  .tabs {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: var(--sp-2);
    overflow-y: auto;
    min-height: 0;
  }

  .tab-group-label {
    padding: var(--sp-3) var(--sp-3) var(--sp-1);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-disabled);
  }

  .tab {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    background: none;
    border: none;
    border-radius: var(--r-sm);
    padding: 0 var(--sp-3);
    height: var(--control-h-md);
    color: var(--text-secondary);
    font-size: 0.8rem;
    text-align: left;
    cursor: pointer;
  }

  .tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .tab.active {
    background: var(--accent-bg-subtle);
    color: var(--accent-text);
  }

  .badge {
    padding: 0 5px;
    border-radius: var(--r-sm);
    background: var(--surface-raised);
    color: var(--text-muted);
    font-size: 0.7rem;
  }

  /* 고아 목록 — 이름과 '나가는 링크 수'를 나란히. 그 숫자가 허브를 가른다. */
  /**
   * 미완 작업의 중첩 — 원문의 들여쓰기를 그대로 보인다.
   *
   * ⚠️ 깊이를 버리면 "부모 하나"와 "자식 셋"이 같은 줄로 보인다. 무엇에 딸린 일인지가
   * 사라지면 목록이 그냥 문장 더미가 된다.
   */
  .make {
    all: unset;
    padding: 0 var(--sp-2);
    border: 1px solid var(--border-default);
    border-radius: var(--r-sm);
    color: var(--text-secondary);
    font-size: var(--fs-xs);
    cursor: pointer;
  }

  .make:hover {
    border-color: var(--accent);
    color: var(--text-primary);
  }

  /* 작업 한 줄 — 눌러서 그 자리로 간다. 글자처럼 보이되 초점은 받는다. */
  .task-jump {
    all: unset;
    cursor: pointer;
    color: var(--text-secondary);
  }

  .task-jump:hover {
    color: var(--text-primary);
    text-decoration: underline;
  }

  .task-jump:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--r-sm);
  }

  .stale-row {
    display: flex;
    align-items: baseline;
    gap: var(--sp-2);
    justify-content: space-between;
  }

  .task-row {
    padding-left: calc(var(--task-depth, 0) * 14px);
  }

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
