<script lang="ts">
  import { gitBannerVisible, gitBusy, startVersioning, dismissBanner } from "$lib/stores/git";
  import { vaultPath } from "$lib/stores/vault";
  import { GitBranch } from "@lucide/svelte";

  /**
   * 버전관리 미설정 vault에 1회 노출되는 권유 배너 (ADR-004 V2).
   * [시작]=git init + 자동 커밋 활성, [나중에]=이 vault에선 다시 안 띄움(영속).
   * 강제하지 않음 — .git 생성은 비자명 변경이므로 opt-in.
   */
</script>

{#if $gitBannerVisible}
  <div class="git-banner" role="region" aria-label="버전관리 권유">
    <span class="icon" aria-hidden="true"><GitBranch size={15} /></span>
    <span class="msg">
      이 vault는 버전관리되지 않습니다. 시작하면 변경이 자동으로 이력에 기록됩니다.
      <span class="hint">(<code>_memories</code> 등 제외)</span>
    </span>
    <div class="actions">
      <button
        class="btn btn--primary btn--sm"
        disabled={$gitBusy || !$vaultPath}
        onclick={() => $vaultPath && startVersioning($vaultPath)}
      >
        {$gitBusy ? "시작 중…" : "버전관리 시작"}
      </button>
      <button
        class="btn btn--plain btn--sm"
        disabled={$gitBusy || !$vaultPath}
        onclick={() => $vaultPath && dismissBanner($vaultPath)}
      >나중에</button>
    </div>
  </div>
{/if}

<style>
  .git-banner {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-5);
    background: var(--surface-raised);
    border-bottom: 1px solid var(--border-default);
    font-size: var(--fs-sm);
    color: var(--text-secondary);
  }

  .icon {
    display: inline-flex;
    align-items: center;
    color: var(--accent);
    flex-shrink: 0;
  }

  .msg {
    flex: 1;
    min-width: 0;
  }

  .hint {
    color: var(--text-muted);
  }

  .hint code {
    font-size: 0.92em;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    flex-shrink: 0;
  }
</style>
