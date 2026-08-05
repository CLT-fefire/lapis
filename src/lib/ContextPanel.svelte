<script lang="ts">
  import type { ComponentProps } from "svelte";
  import { FileCode2, ListTree, Share2, Paperclip } from "@lucide/svelte";
  import SidebarSection from "./SidebarSection.svelte";
  import Properties from "./Properties.svelte";
  import OutlinePanel from "./OutlinePanel.svelte";
  import Neighborhood from "./Neighborhood.svelte";
  import PublishedAssets from "./PublishedAssets.svelte";
  import { contextSections, toggleContextSection } from "$lib/stores/context";
  import { outlineHeadings } from "$lib/stores/outline";

  /**
   * 우측 컨텍스트 패널 — "이 문서에 딸린 것"을 모은 세로 아코디언 (PR-4).
   * 좌측 사이드바(vault 탐색)와 대칭을 이루도록 SidebarSection 관용구를 그대로 쓴다.
   *
   * 데이터는 전부 +page.svelte의 derived를 props로 받는다 — 이 컴포넌트는 배치만 한다.
   */
  interface Props {
    properties: ComponentProps<typeof Properties>;
    /** 노트 미선택이면 null — 관계/자산 섹션을 숨긴다. */
    neighborhood: ComponentProps<typeof Neighborhood> | null;
    notePath: string | null;
  }
  let { properties, neighborhood, notePath }: Props = $props();

  const relationCount = $derived(
    neighborhood
      ? (neighborhood.outgoing?.length ?? 0) +
          (neighborhood.incoming?.length ?? 0) +
          (neighborhood.backlinks?.length ?? 0)
      : null,
  );
</script>

<aside class="context-panel" aria-label="문서 컨텍스트">
  <SidebarSection
    icon={FileCode2}
    label="속성"
    open={$contextSections.properties}
    onToggle={() => toggleContextSection("properties")}
  >
    {#snippet children()}<Properties {...properties} />{/snippet}
  </SidebarSection>

  <SidebarSection
    icon={ListTree}
    label="목차"
    open={$contextSections.outline}
    count={$outlineHeadings.length || null}
    onToggle={() => toggleContextSection("outline")}
  >
    {#snippet children()}<OutlinePanel />{/snippet}
  </SidebarSection>

  {#if neighborhood}
    <SidebarSection
      icon={Share2}
      label="관계 · 백링크"
      open={$contextSections.relations}
      count={relationCount}
      onToggle={() => toggleContextSection("relations")}
    >
      {#snippet children()}<Neighborhood {...neighborhood} />{/snippet}
    </SidebarSection>
  {/if}

  {#if notePath}
    <SidebarSection
      icon={Paperclip}
      label="발행 자산"
      open={$contextSections.assets}
      onToggle={() => toggleContextSection("assets")}
    >
      {#snippet children()}<PublishedAssets {notePath} />{/snippet}
    </SidebarSection>
  {/if}
</aside>

<style>
  .context-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    /* 사이드바와 같은 크롬 계층 — 본문(--surface-content)을 사이에 두고 좌우 대칭. */
    background: var(--surface-panel);
  }
</style>
