<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import type { ComponentProps } from "svelte";
  import { FileCode2, ListTree, Share2, Paperclip, type LucideIcon } from "@lucide/svelte";
  import Properties from "./Properties.svelte";
  import OutlinePanel from "./OutlinePanel.svelte";
  import Neighborhood from "./Neighborhood.svelte";
  import PublishedAssets from "./PublishedAssets.svelte";
  import { contextTab, showContextTab, type ContextSectionKey } from "$lib/stores/context";
  import { outlineHeadings } from "$lib/stores/outline";

  /**
   * 우측 컨텍스트 패널 — "이 문서에 딸린 것"을 **세그먼트 탭**으로.
   *
   * ⚠️ 각 탭의 내용(`Properties` · `OutlinePanel` · `Neighborhood` · `PublishedAssets`)은
   * 손대지 않는다. 바뀐 것은 **컨테이너뿐**이다.
   *
   * 데이터는 전부 `+page.svelte` 의 derived 를 props 로 받는다 — 이 컴포넌트는 배치만 한다.
   */
  interface Props {
    properties: ComponentProps<typeof Properties>;
    /** 노트 미선택이면 null — 관계 탭을 숨긴다. */
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

  /**
   * 보이는 탭 목록.
   *
   * ⚠️ 관계·자산은 **조건부**다(노트가 없으면 없다). 안 보이는 탭이 활성이면 패널이
   * 비어 보이므로 아래 effect 가 되돌린다 — 빈 화면은 고장과 구별이 안 된다.
   */
  const tabs = $derived<{ key: ContextSectionKey; icon: LucideIcon; label: string; count: number | null }[]>(
    [
      { key: "properties", icon: FileCode2, label: m.ctxpanel_properties(), count: null },
      { key: "outline", icon: ListTree, label: m.ctxpanel_outline(), count: $outlineHeadings.length || null },
      ...(neighborhood
        ? [{ key: "relations" as const, icon: Share2, label: m.ctxpanel_relations(), count: relationCount }]
        : []),
      ...(notePath
        ? [{ key: "assets" as const, icon: Paperclip, label: m.ctxpanel_assets(), count: null }]
        : []),
    ],
  );

  $effect(() => {
    if (!tabs.some((t) => t.key === $contextTab)) showContextTab("properties");
  });
</script>

<aside class="context-panel" data-lapis="context-panel" aria-label={m.ctxpanel_aria()}>
  <div class="segments" role="tablist" aria-label={m.ctxpanel_aria()}>
    {#each tabs as t (t.key)}
      {@const Icon = t.icon}
      <button
        class="segment"
        class:active={$contextTab === t.key}
        role="tab"
        aria-selected={$contextTab === t.key}
        title={t.label}
        onclick={() => showContextTab(t.key)}
      >
        <Icon size={14} strokeWidth={2} aria-hidden="true" />
        <span class="seg-label">{t.label}</span>
        {#if t.count}<span class="seg-count">{t.count}</span>{/if}
      </button>
    {/each}
  </div>

  <div class="ctx-body">
    {#if $contextTab === "properties"}
      <Properties {...properties} />
    {:else if $contextTab === "outline"}
      <OutlinePanel />
    {:else if $contextTab === "relations" && neighborhood}
      <Neighborhood {...neighborhood} />
    {:else if $contextTab === "assets" && notePath}
      <PublishedAssets {notePath} />
    {/if}
  </div>
</aside>

<style>
  .context-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    /* 사이드바와 같은 크롬 계층 — 본문(--surface-content)을 사이에 두고 좌우 대칭. */
    background: var(--surface-panel);
  }

  .segments {
    display: flex;
    gap: 2px;
    padding: var(--sp-2) var(--sp-2) 0;
    flex: none;
    /* 탭이 넷이고 라벨이 한국어라 좁은 폭에서 넘칠 수 있다. 줄이지 말고 가로로 흘린다. */
    overflow-x: auto;
  }

  .segment {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: 0 var(--sp-3);
    height: var(--control-h-sm);
    background: none;
    border: none;
    border-radius: var(--r-sm);
    color: var(--text-muted);
    font: inherit;
    font-size: var(--fs-xs);
    white-space: nowrap;
    cursor: pointer;
    transition:
      background var(--dur-1) var(--ease-standard),
      color var(--dur-1) var(--ease-standard);
  }

  .segment:hover {
    background: var(--surface-hover);
    color: var(--text-secondary);
  }

  .segment.active {
    background: var(--accent-bg-subtle);
    color: var(--accent-text);
  }

  .seg-count {
    color: var(--text-disabled);
  }

  .segment.active .seg-count {
    color: inherit;
  }

  /* ⚠️ `min-height: 0` — 목차가 길어도 패널을 밀어내지 않고 여기서 스크롤한다. */
  .ctx-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
</style>
