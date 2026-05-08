<script lang="ts">
  import { onDestroy } from "svelte";
  import cytoscape, {
    type Core,
    type ElementDefinition,
    type LayoutOptions,
  } from "cytoscape";
  // @ts-expect-error - cytoscape-fcose 패키지에 타입 정의 미제공
  import cytoscapeFcose from "cytoscape-fcose";
  import { graphOpen, closeGraph } from "$lib/stores/graph";
  import { linkIndex, currentNotePath, selectNote } from "$lib/stores/vault";
  import { tagIndex, selectTag, showTagsTab } from "$lib/stores/tags";
  import { buildGraphData, getNeighbors, type GraphMode } from "$lib/graph";

  // ESM/CJS interop 안전 처리 — Vite가 default export를 wrapping할 수 있음
  const fcoseRegister =
    (cytoscapeFcose as { default?: (cy: typeof cytoscape) => void }).default ??
    (cytoscapeFcose as unknown as (cy: typeof cytoscape) => void);

  let fcoseRegistered = false;
  try {
    if (typeof fcoseRegister === "function" && !fcoseRegistered) {
      cytoscape.use(fcoseRegister as Parameters<typeof cytoscape.use>[0]);
      fcoseRegistered = true;
    }
  } catch (e) {
    console.warn("[Graph] fcose register failed, falling back to cose", e);
  }

  let containerEl: HTMLDivElement | null = $state(null);
  let cy: Core | null = null;
  let stats = $state({ nodes: 0, edges: 0, isolated: 0 });
  let showIsolated = $state(false);
  let mode: GraphMode = $state("both");

  // 모달 open + container 마운트 + 인덱스 준비되면 cytoscape 인스턴스 생성/갱신
  $effect(() => {
    if (!$graphOpen || !containerEl) {
      destroyCy();
      return;
    }
    const idx = $linkIndex;
    if (!idx) return;
    const data = buildGraphData(idx, {
      alwaysInclude: $currentNotePath ?? undefined,
      showIsolated,
      mode,
      tagIndex: $tagIndex,
    });
    stats = {
      nodes: data.nodes.length,
      edges: data.edges.length,
      isolated: data.isolatedCount,
    };
    const elements: ElementDefinition[] = [...data.nodes, ...data.edges];

    console.log(
      "[Graph] visible nodes:",
      data.nodes.length,
      "edges:",
      data.edges.length,
      "isolated hidden:",
      data.isolatedCount,
      "fcoseRegistered:",
      fcoseRegistered,
    );

    destroyCy();

    cy = cytoscape({
      container: containerEl,
      elements,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#3a3a3a",
            "border-color": "#555",
            "border-width": 1,
            label: "data(label)",
            color: "#888",
            "font-size": "9px",
            "text-valign": "bottom",
            "text-margin-y": 3,
            "text-wrap": "ellipsis",
            "text-max-width": "120px",
            "min-zoomed-font-size": 10,
            width: 12,
            height: 12,
          },
        },
        {
          selector: "node.neighbor",
          style: {
            "background-color": "#9adff7",
            "border-color": "#6dd6ff",
            color: "#ccc",
            "font-size": "10px",
            "min-zoomed-font-size": 8,
            width: 18,
            height: 18,
          },
        },
        {
          selector: "node.current",
          style: {
            "background-color": "#6dd6ff",
            "border-color": "#fff",
            "border-width": 2,
            color: "#fff",
            "font-size": "13px",
            "font-weight": "bold",
            "min-zoomed-font-size": 0,
            width: 28,
            height: 28,
            "z-index": 100,
          },
        },
        {
          selector: "node:active, node:selected",
          style: {
            "overlay-opacity": 0,
          },
        },
        {
          selector: "edge",
          style: {
            width: 1,
            "line-color": "#444",
            "target-arrow-color": "#555",
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.7,
            "curve-style": "bezier",
            opacity: 0.55,
          },
        },
        {
          selector: "edge[edgeKind = 'tag']",
          style: {
            width: 1,
            "line-color": "#5a4a2a",
            "line-style": "dashed",
            "target-arrow-shape": "none",
            "curve-style": "bezier",
            opacity: 0.4,
          },
        },
        {
          selector: "edge.touching",
          style: {
            "line-color": "#6dd6ff",
            "target-arrow-color": "#6dd6ff",
            opacity: 1,
            width: 2,
            "z-index": 50,
          },
        },
        {
          selector: "node[kind = 'tag']",
          style: {
            "background-color": "#f7c947",
            "border-color": "#ffd97b",
            "border-width": 1,
            shape: "diamond",
            label: "data(label)",
            color: "#d8b248",
            "font-size": "10px",
            "font-weight": "bold",
            "text-valign": "bottom",
            "text-margin-y": 3,
            "min-zoomed-font-size": 8,
            width: 14,
            height: 14,
          },
        },
      ],
      // fcose 등록되어 있으면 그것을, 아니면 내장 cose (function 옵션 형식)
      layout: (fcoseRegistered
        ? {
            name: "fcose",
            animate: false,
            randomize: true,
            quality: "default",
            nodeRepulsion: 8000,
            idealEdgeLength: 80,
            edgeElasticity: 0.45,
            gravity: 0.25,
            fit: true,
            padding: 40,
          }
        : {
            name: "cose",
            animate: false,
            randomize: true,
            // cose는 number가 아닌 function 옵션을 받음
            nodeRepulsion: () => 400000,
            idealEdgeLength: () => 90,
            edgeElasticity: () => 100,
            nodeOverlap: 24,
            gravity: 80,
            numIter: 1000,
            nestingFactor: 1.2,
            coolingFactor: 0.95,
            minTemp: 1.0,
            componentSpacing: 80,
            fit: true,
            padding: 40,
          }) as unknown as LayoutOptions,
      wheelSensitivity: 0.2,
      minZoom: 0.1,
      maxZoom: 3,
    });

    // 현재 노트 + 1-hop 이웃 강조
    const cur = $currentNotePath;
    if (cur) {
      const neighbors = getNeighbors(cur, idx);
      cy.nodes().forEach((n) => {
        if (n.id() === cur) n.addClass("current");
        else if (neighbors.has(n.id())) n.addClass("neighbor");
      });
      cy.edges().forEach((e) => {
        if (e.source().id() === cur || e.target().id() === cur) e.addClass("touching");
      });
      const curNode = cy.getElementById(cur);
      if (curNode.nonempty()) {
        cy.center(curNode);
        cy.zoom({ level: 1.2, position: curNode.position() });
      }
    }

    // 노드 클릭 분기 — note는 점프, tag는 사이드바 Tags 탭으로
    cy.on("tap", "node", (evt) => {
      const node = evt.target;
      const kind = node.data("kind");
      if (kind === "tag") {
        const tagKey: string | undefined = node.data("tagKey");
        if (tagKey) {
          selectTag(tagKey);
          showTagsTab();
        }
      } else {
        selectNote(node.id());
      }
      closeGraph();
    });
  });

  function destroyCy() {
    if (cy) {
      cy.destroy();
      cy = null;
    }
  }

  onDestroy(destroyCy);

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeGraph();
    }
  }

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) closeGraph();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if $graphOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="graph-backdrop" onclick={onBackdrop}>
    <div class="graph-modal" role="dialog" aria-modal="true" aria-label="Graph view">
      <header class="graph-head">
        <span class="title">Graph</span>
        <div class="mode-group" role="group" aria-label="Graph mode">
          <button
            class="mode-btn"
            class:active={mode === "links"}
            onclick={() => (mode = "links")}
            title="명시적 link만"
          >Links</button>
          <button
            class="mode-btn"
            class:active={mode === "tags"}
            onclick={() => (mode = "tags")}
            title="태그 노드 + 노트"
          >Tags</button>
          <button
            class="mode-btn"
            class:active={mode === "both"}
            onclick={() => (mode = "both")}
            title="link + 태그 모두"
          >Both</button>
        </div>
        <span class="stats">
          {stats.nodes} nodes · {stats.edges} edges
          {#if stats.isolated > 0 && !showIsolated}
            · <span class="hidden-note">{stats.isolated} isolated hidden</span>
          {/if}
        </span>
        <label class="isolated-toggle" title="다른 노트와 연결 없는 노트도 표시">
          <input type="checkbox" bind:checked={showIsolated} />
          isolated 표시
        </label>
        <button class="close-btn" title="닫기 (Esc)" onclick={closeGraph}>×</button>
      </header>
      <div class="graph-body" bind:this={containerEl}></div>
      {#if !$linkIndex}
        <div class="overlay-msg">vault를 먼저 선택하세요.</div>
      {:else if stats.nodes === 0}
        <div class="overlay-msg">표시할 노트가 없습니다.</div>
      {/if}
      <footer class="graph-foot">
        <span>클릭 노트 점프</span>
        <span>휠 줌</span>
        <span>드래그 팬</span>
        <span>Esc 닫기</span>
      </footer>
    </div>
  </div>
{/if}

<style>
  .graph-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 32px;
  }

  .graph-modal {
    width: 100%;
    height: 100%;
    max-width: 1400px;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 10px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    color: #e8e8e8;
    position: relative;
  }

  .graph-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 14px;
    background: #252526;
    border-bottom: 1px solid #333;
    font-size: 12px;
  }

  .title {
    font-weight: 700;
    letter-spacing: 0.06em;
    color: #6dd6ff;
    text-transform: uppercase;
    font-size: 11px;
  }

  .stats {
    color: #888;
    flex: 1;
  }

  .mode-group {
    display: inline-flex;
    border: 1px solid #444;
    border-radius: 4px;
    overflow: hidden;
  }

  .mode-btn {
    background: #2a2a2a;
    border: none;
    color: #aaa;
    padding: 4px 10px;
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
    border-right: 1px solid #444;
    transition: background 0.1s, color 0.1s;
  }

  .mode-btn:last-child {
    border-right: none;
  }

  .mode-btn:hover {
    background: #333;
    color: #ddd;
  }

  .mode-btn.active {
    background: #2d4a5a;
    color: #6dd6ff;
  }

  .hidden-note {
    color: #aaa;
  }

  .isolated-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #aaa;
    font-size: 11px;
    cursor: pointer;
    user-select: none;
    padding: 4px 8px;
    border-radius: 4px;
    transition: background 0.1s;
  }

  .isolated-toggle:hover {
    background: #2a2a2a;
    color: #ccc;
  }

  .isolated-toggle input {
    margin: 0;
    cursor: pointer;
    accent-color: #6dd6ff;
  }

  .close-btn {
    background: transparent;
    border: 1px solid #444;
    color: #ccc;
    width: 28px;
    height: 24px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: inherit;
  }

  .close-btn:hover {
    border-color: #6dd6ff;
    color: #fff;
  }

  .graph-body {
    flex: 1;
    background: #1a1a1a;
    position: relative;
  }

  .overlay-msg {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #777;
    font-size: 13px;
    pointer-events: none;
  }

  .graph-foot {
    display: flex;
    gap: 16px;
    justify-content: flex-end;
    padding: 6px 14px;
    background: #252526;
    border-top: 1px solid #333;
    font-size: 11px;
    color: #888;
  }
</style>
