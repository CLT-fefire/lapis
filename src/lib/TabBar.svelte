<script lang="ts">
  import { openTabs } from "$lib/stores/tabs";
  import { currentNotePath, selectNote, closeTab } from "$lib/stores/vault";
  import { isDirty } from "$lib/stores/editor";
  import { noteStem } from "$lib/notePath";

  let barEl: HTMLDivElement | undefined = $state();

  // 활성 탭이 가로 스크롤 영역 밖이면 보이도록 스크롤.
  // $currentNotePath 변경 → class:active DOM 반영 후 $effect 실행 → 활성 탭 가시화.
  // block:nearest 로 세로(페이지) 점프 방지, inline:nearest 로 가로만 최소 이동.
  $effect(() => {
    void $currentNotePath; // 의존성 추적
    if (!barEl) return;
    const el = barEl.querySelector<HTMLElement>(".tab.active");
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  function onTabClick(path: string) {
    if (path !== $currentNotePath) void selectNote(path);
  }

  function onClose(e: MouseEvent, path: string) {
    e.stopPropagation(); // 탭 클릭(활성화)과 분리
    void closeTab(path);
  }
</script>

{#if $openTabs.length > 0}
  <div class="tab-bar" role="tablist" bind:this={barEl}>
    {#each $openTabs as path (path)}
      <div
        class="tab"
        class:active={path === $currentNotePath}
        role="tab"
        tabindex="0"
        aria-selected={path === $currentNotePath}
        title={path}
        onclick={() => onTabClick(path)}
        onkeydown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onTabClick(path);
          }
        }}
      >
        {#if path === $currentNotePath && $isDirty}
          <span class="dirty" aria-label="저장되지 않음">●</span>
        {/if}
        <span class="label">{noteStem(path)}</span>
        <button
          class="btn btn--icon btn--sm btn--plain close"
          title="탭 닫기 (⌘W)"
          aria-label="탭 닫기"
          onclick={(e) => onClose(e, path)}
        >✕</button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .tab-bar {
    display: flex;
    align-items: stretch;
    gap: var(--sp-1);
    padding: var(--sp-1) var(--sp-2) 0;
    background: var(--surface-base);
    border-bottom: 1px solid var(--border-default);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    max-width: 200px;
    padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-3);
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    border-bottom: none;
    border-radius: var(--r-sm) var(--r-sm) 0 0;
    color: var(--text-secondary);
    font-size: var(--fs-sm);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .tab:hover {
    background: var(--surface-overlay);
    color: var(--text-primary);
  }

  .tab.active {
    background: var(--surface-base);
    color: var(--text-primary);
    border-color: var(--border-strong);
  }

  .tab .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab .dirty {
    flex-shrink: 0;
    color: var(--accent);
    font-size: var(--fs-xs);
  }

  .tab .close {
    flex-shrink: 0;
    font-size: var(--fs-xs);
    opacity: 0.6;
  }

  .tab .close:hover {
    opacity: 1;
  }
</style>
