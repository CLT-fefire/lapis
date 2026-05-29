<script lang="ts">
  import { selectNote, vaultPath, currentNotePath } from "$lib/stores/vault";
  import { memoryFindExportedNote } from "$lib/tauri/memory";
  import { mirrorQueryRelatedToNote, type MirrorRelatedHit } from "$lib/tauri/mirror";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";

  let items: MirrorRelatedHit[] = $state([]);
  let loading = $state(false);
  let errorMsg = $state("");
  let collapsed = $state(true);
  let hidden = $state(true);

  // 현재 노트 변경 시 자동 fetch. _memories 안의 노트면 표시 안 함.
  $effect(() => {
    const path = $currentNotePath;
    const vault = $vaultPath;
    items = [];
    errorMsg = "";
    if (!path || !vault) {
      hidden = true;
      return;
    }
    if (path.includes("/_memories/")) {
      hidden = true;
      return;
    }
    hidden = false;
    void refresh(path);
  });

  // WAL watch가 mirror sync를 끝낸 후 패널도 새로 고침 — 같은 노트에 새 메모리가 매치될 수 있음.
  $effect(() => {
    let unlisten: UnlistenFn | null = null;
    void listen("mirror-sync-done", () => {
      const path = $currentNotePath;
      if (path && !path.includes("/_memories/")) {
        void refresh(path);
      }
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  });

  async function refresh(path: string) {
    loading = true;
    try {
      const result = await mirrorQueryRelatedToNote(path);
      items = result;
      collapsed = result.length === 0;
      errorMsg = "";
    } catch (e) {
      errorMsg = `${e}`;
    } finally {
      loading = false;
    }
  }

  async function open(item: MirrorRelatedHit) {
    const vault = $vaultPath;
    if (!vault) return;
    try {
      const abs = await memoryFindExportedNote(vault, item.source_id, item.type);
      if (abs) {
        void selectNote(abs);
      } else {
        errorMsg = `vault에 export된 노트가 없습니다 (${item.type} mem_id=${item.source_id}). Memory: Sync 먼저 실행.`;
      }
    } catch (e) {
      errorMsg = `점프 실패: ${e}`;
    }
  }

  /** 합집합 role → 표시 라벨. 2개 이상이면 "both". */
  function rolesLabel(roles: readonly string[]): string {
    if (roles.length === 0) return "both";
    if (roles.length > 1) return "both";
    const r = roles[0];
    if (r === "edited") return "edited";
    if (r === "modified") return "modified";
    if (r === "read") return "read";
    return r;
  }

  /** 배지 CSS class — 기존 RelatedMemoriesPanel 톤 유지. */
  function rolesClass(roles: readonly string[]): string {
    if (roles.length > 1) return "both";
    const r = roles[0];
    if (r === "edited") return "files_edited";
    if (r === "modified") return "files_modified";
    if (r === "read") return "files_read";
    return "";
  }
</script>

{#if !hidden}
  <section class="related">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="head" onclick={() => (collapsed = !collapsed)}>
      <span class="caret">{collapsed ? "▶" : "▼"}</span>
      <span class="title">관련 메모리</span>
      {#if loading}
        <span class="meta">…</span>
      {:else}
        <span class="meta">{items.length}건</span>
      {/if}
    </div>
    {#if !collapsed}
      {#if errorMsg}
        <div class="err">{errorMsg}</div>
      {:else if items.length === 0 && !loading}
        <div class="empty">매칭되는 메모리 없음</div>
      {:else}
        <ul>
          {#each items as item (`${item.type}-${item.source_id}`)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <li onclick={() => open(item)}>
              <div class="li-head">
                <span class="kind {item.type === 'observation' ? 'obs' : 'summary'}">
                  {item.type === "observation" ? "obs" : "summary"}
                </span>
                <span class="li-title">{item.title}</span>
                <span class="badge {rolesClass(item.matched_roles)}">{rolesLabel(item.matched_roles)}</span>
              </div>
              <div class="li-meta">{item.project} · {item.created_at.slice(0, 10)}</div>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .related {
    margin-top: 24px;
    border-top: 1px solid var(--border-subtle);
    padding-top: 14px;
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    cursor: pointer;
    user-select: none;
  }

  .caret {
    color: var(--text-muted);
    font-size: 10px;
    width: 12px;
  }

  .title {
    color: var(--violet);
    font-weight: 600;
    font-size: var(--fs-base);
  }

  .meta {
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }

  .err {
    color: var(--danger);
    font-size: var(--fs-sm);
    padding: 8px 0 0 20px;
  }

  .empty {
    color: var(--text-muted);
    font-size: var(--fs-sm);
    padding: 8px 0 0 20px;
  }

  ul {
    list-style: none;
    margin: 8px 0 0;
    padding: 0 0 0 20px;
  }

  li {
    padding: 6px 0;
    border-bottom: 1px dashed var(--border-subtle);
    cursor: pointer;
  }

  li:hover {
    background: var(--violet-bg-subtle);
  }

  li:last-child {
    border-bottom: none;
  }

  .li-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 2px;
  }

  .li-title {
    font-size: var(--fs-sm);
    color: var(--text-primary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    flex-shrink: 0;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 7px;
    background: var(--violet-bg-subtle);
    color: var(--violet);
    border: 1px solid var(--violet-border);
  }

  .badge.files_edited {
    background: var(--warning-bg-subtle);
    color: var(--warning);
    border-color: var(--warning-border);
  }

  /* observation의 files_modified — files_edited와 동일 톤 (의미적으로 같은 "수정") */
  .badge.files_modified {
    background: var(--warning-bg-subtle);
    color: var(--warning);
    border-color: var(--warning-border);
  }

  .badge.both {
    background: var(--accent-bg-subtle);
    color: var(--accent);
    border-color: var(--accent-border);
  }

  /* 본문 언급 — 가장 약한 신호라 회색 톤 */
  .badge.body {
    background: var(--surface-sunken);
    color: var(--text-secondary);
    border-color: var(--border-strong);
  }

  /* kind 배지 — MemorySyncModal / SearchModal과 톤 통일 */
  .kind {
    flex-shrink: 0;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 5px;
    border-radius: 3px;
  }

  .kind.summary {
    background: var(--violet-bg-subtle);
    color: var(--violet);
    border: 1px solid var(--violet-border);
  }

  .kind.obs {
    background: var(--teal-bg-subtle);
    color: var(--teal);
    border: 1px solid var(--teal-border);
  }

  .li-meta {
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }
</style>
