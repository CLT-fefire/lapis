<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { FolderOpen, Clock, X } from "@lucide/svelte";
  import { pickAndOpenVault, openVault } from "$lib/stores/vault";
  import { recentVaults, forgetVault } from "$lib/stores/recentVaults";

  /**
   * vault 미선택 — **화면 전체**가 빈 상태다.
   *
   * ## ⚠️ 왜 사이드바 안의 문구로는 부족한가
   *
   * v2 는 "vault 폴더를 선택하면 .md 파일들이 여기 표시됩니다"를 사이드바 안에 뒀다.
   * 그런데 그때 화면의 나머지 전부 — 탭 스트립 · 노트 헤더 · 컨텍스트 패널 — 는 **평소와
   * 똑같이** 그려져 있었다. 빈 사이드바 하나만 다른 화면은 "아직 안 골랐다"가 아니라
   * "뭔가 안 불러와졌다"로 읽힌다.
   *
   * ## 최근 vault
   *
   * ⌘⇧T 로 창마다 다른 vault 를 여는 사용 패턴에서, 매번 파일 다이얼로그를 지나야 했다.
   * ⚠️ 목록은 **경로가 아직 있는지 확인하지 않는다.** 확인하려면 창이 뜰 때마다 디스크를
   * 두드려야 하고, 못 여는 경로는 어차피 열 때 알 수 있다 — 그때 목록에서 뺀다.
   */

  function shortName(path: string): string {
    const parts = path.replace(/[/\\]+$/, "").split(/[/\\]/);
    return parts[parts.length - 1] || path;
  }

  async function open(path: string) {
    try {
      await openVault(path);
    } catch (e) {
      // 폴더가 지워졌거나 권한이 없다 — 계속 권하지 않는다.
      console.warn("recent vault open failed", e);
      forgetVault(path);
    }
  }
</script>

<div class="empty" data-lapis="vault-empty">
  <div class="card">
    <h1 class="title">{m.empty_title()}</h1>
    <p class="desc">{m.empty_desc()}</p>

    <button class="btn btn--primary btn--lg pick" onclick={pickAndOpenVault}>
      <FolderOpen size={16} strokeWidth={2} aria-hidden="true" />
      {m.sidebar_open_vault()}
    </button>

    {#if $recentVaults.length > 0}
      <div class="recent">
        <div class="recent-head">
          <Clock size={13} strokeWidth={2} aria-hidden="true" />
          {m.empty_recent()}
        </div>
        <ul class="recent-list">
          {#each $recentVaults as path (path)}
            <li>
              <button class="recent-item" title={path} onclick={() => open(path)}>
                <span class="rv-name">{shortName(path)}</span>
                <span class="rv-path">{path}</span>
              </button>
              <button
                class="rv-forget"
                title={m.empty_recent_forget()}
                aria-label={m.empty_recent_forget()}
                onclick={() => forgetVault(path)}
              >
                <X size={13} strokeWidth={2} aria-hidden="true" />
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <p class="note">{m.empty_local_only()}</p>
  </div>
</div>

<style>
  .empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--sp-8);
    background: var(--surface-content);
    overflow-y: auto;
  }

  .card {
    width: 100%;
    max-width: 460px;
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
  }

  .title {
    margin: 0;
    font-size: var(--fs-2xl);
    font-weight: 600;
    color: var(--text-primary);
  }

  .desc {
    margin: 0;
    color: var(--text-secondary);
    line-height: 1.6;
  }

  .pick {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .recent {
    margin-top: var(--sp-4);
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  .recent-head {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .recent-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .recent-list > li {
    display: flex;
    align-items: stretch;
    gap: var(--sp-1);
  }

  .recent-item {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    align-items: flex-start;
    padding: var(--sp-2) var(--sp-3);
    background: none;
    border: none;
    border-radius: var(--r-sm);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .recent-item:hover {
    background: var(--surface-hover);
  }

  .rv-name {
    font-weight: 600;
    color: var(--text-primary);
  }

  /* ⚠️ 경로는 길다. 줄바꿈하면 항목 높이가 제각각이 되어 목록이 목록으로 안 읽힌다. */
  .rv-path {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-xs);
    color: var(--text-disabled);
  }

  .rv-forget {
    flex: none;
    width: var(--control-h-md);
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    border-radius: var(--r-sm);
    color: var(--text-disabled);
    cursor: pointer;
  }

  .rv-forget:hover {
    background: var(--surface-hover);
    color: var(--text-secondary);
  }

  .note {
    margin: var(--sp-4) 0 0;
    font-size: var(--fs-xs);
    color: var(--text-muted);
    line-height: 1.6;
  }
</style>
