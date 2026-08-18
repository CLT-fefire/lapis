<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
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
  <div class="git-banner" role="region" aria-label={m.git_banner_aria()}>
    <span class="icon" aria-hidden="true"><GitBranch size={15} /></span>
    <span class="msg">
      {m.git_banner_body()}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    <span class="hint">{@html m.git_banner_hint()}</span>
    </span>
    <div class="actions">
      <button
        class="btn btn--primary btn--sm"
        disabled={$gitBusy || !$vaultPath}
        onclick={() => $vaultPath && startVersioning($vaultPath)}
      >
        {$gitBusy ? m.git_banner_starting() : m.git_banner_start()}
      </button>
      <button
        class="btn btn--plain btn--sm"
        disabled={$gitBusy || !$vaultPath}
        onclick={() => $vaultPath && dismissBanner($vaultPath)}
      >{m.git_banner_later()}</button>
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

  /* ⚠️ `:global()` — 인라인 마크업이 있어 `{@html}`로 그린다. Svelte scoped CSS는
     `{@html}` 주입 요소에 안 붙는다(스코프 클래스 미부착). */
  .hint :global(code) {
    font-size: 0.92em;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    flex-shrink: 0;
  }
</style>
