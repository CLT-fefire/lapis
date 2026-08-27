<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import {
    vaultPath,
    linkIndex,
    currentNotePath,
    indexBuilding,
    indexRefreshing,
    treeLoading,
  } from "$lib/stores/vault";
  import { watcherStatus } from "$lib/stores/watcher";

  /**
   * 상태바 — 셸의 마지막 줄.
   *
   * ## ⚠️ 왜 사이드바 푸터에서 옮겼나
   *
   * 감시 상태와 노트 수는 **창에 딸린 정보**인데 사이드바 안에 있었다. 사이드바를 접으면
   * 같이 사라진다 — 접었다고 감시가 멈춘 것도, 노트가 없어진 것도 아닌데.
   *
   * 문서 통계와 현재 경로도 여기로 모은다. 노트 헤더에 흩어져 있던 것들이고, 헤더는
   * "지금 보는 것의 이름"만 남는 편이 읽기 쉽다.
   *
   * ⚠️ **설정 버튼은 여기 두지 않는다.** 라벨 없는 작은 ⚙ 는 인지가 어렵다는 과거 피드백을
   * 되돌리게 된다. 진입 경로는 레일 ⚙ · vault 메뉴 · ⌘K 로 이미 셋이다.
   */

  interface Props {
    /** 문서 통계 문구. 노트가 없으면 `null`. 계산은 `+page.svelte` 가 이미 하고 있다. */
    docStats?: string | null;
    /** 경로 복사. 노트 헤더의 것과 **같은 경로**를 탄다 — 두 벌이 되면 갈린다. */
    onCopyPath?: () => void;
    pathCopied?: boolean;
  }

  let { docStats = null, onCopyPath, pathCopied = false }: Props = $props();

  const status = $derived.by(() => {
    if ($indexBuilding) return { tone: "busy", text: m.sidebar_status_indexing() };
    if ($indexRefreshing) return { tone: "busy", text: m.sidebar_status_refreshing() };
    if ($treeLoading) return { tone: "busy", text: m.sidebar_status_reading_tree() };
    if ($watcherStatus === "watching") return { tone: "ok", text: m.sidebar_status_watching() };
    if ($watcherStatus === "error") return { tone: "error", text: m.sidebar_status_watch_error() };
    return { tone: "idle", text: m.sidebar_status_idle() };
  });

  const noteCount = $derived($linkIndex ? $linkIndex.byPath.size : 0);

  /** 표시는 마지막 두 조각. **복사되는 것은 절대 경로**다(`onCopyPath` 가 그걸 한다). */
  const shortPath = $derived.by(() => {
    if (!$currentNotePath) return null;
    const segs = $currentNotePath.split("/").filter(Boolean);
    return segs.slice(-2).join("/");
  });
</script>

<footer class="statusbar" data-lapis="statusbar">
  <div class="sb-left">
    {#if $vaultPath}
      <span class="status" title={$vaultPath}>
        <span
          class="dot"
          class:ok={status.tone === "ok"}
          class:busy={status.tone === "busy"}
          class:error={status.tone === "error"}
        ></span>
        <span class="status-text">{status.text}</span>
      </span>
      {#if noteCount > 0}
        <span class="count">{noteCount.toLocaleString()}</span>
      {/if}
    {/if}
  </div>

  <div class="sb-right">
    {#if docStats}
      <span class="stats" title={m.page_stats_title()}>{docStats}</span>
    {/if}
    {#if shortPath}
      <button
        class="path"
        class:copied={pathCopied}
        title={m.statusbar_path_copy()}
        onclick={() => onCopyPath?.()}
      >
        {pathCopied ? "✓ " : ""}{shortPath}
      </button>
    {/if}
  </div>
</footer>

<style>
  .statusbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    height: var(--statusbar-h);
    padding: 0 var(--sp-3);
    background: var(--surface-statusbar);
    color: var(--text-muted);
    font-size: var(--fs-xs);
    user-select: none;
  }

  .sb-left,
  .sb-right {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-width: 0;
  }

  .status {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    min-width: 0;
  }

  .status-text,
  .stats {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: var(--r-full);
    background: var(--text-disabled);
    flex: none;
  }

  .dot.ok {
    background: var(--success);
  }

  /* ⚠️ 작업 중 점은 **기능 신호**다 — reduced-motion 에서도 돈다. */
  .dot.busy {
    background: var(--accent-text);
    animation: pulse-dot 1.4s ease-in-out infinite;
  }

  .dot.error {
    background: var(--danger-text);
  }

  .count {
    color: var(--text-disabled);
  }

  .path {
    background: none;
    border: none;
    padding: 0;
    color: var(--text-muted);
    font: inherit;
    cursor: pointer;
    max-width: 40ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .path:hover {
    color: var(--text-secondary);
  }

  .path.copied {
    color: var(--success);
  }
</style>
