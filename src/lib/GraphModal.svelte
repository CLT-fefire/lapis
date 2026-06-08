<script lang="ts">
  import ModalShell from "$lib/ModalShell.svelte";
  import {
    graphView,
    closeGraph,
    setGraphDepth,
    toggleExpanded,
    recenterGraph,
    MIN_DEPTH,
    MAX_DEPTH,
  } from "$lib/stores/graph";
  import { linkIndex, vaultPath, selectNote } from "$lib/stores/vault";
  import { buildEgoGraph, type EgoNode } from "$lib/egoGraph";
  import type { DocGraphEdge } from "$lib/documentGraph";
  import { forceManyBody, forceCollide } from "d3-force";
  import type ForceGraphType from "force-graph";
  import type { NodeObject, LinkObject } from "force-graph";

  /**
   * PR-G2′ — Local/ego 그래프 (ADR-003). force-graph canvas 렌더 + 인터랙션.
   * 데이터는 egoGraph(순수, vitest 커버). 렌더/인터랙션은 Tauri webview라 사용자 dev 육안검증.
   * - hover = 이웃 강조 · 외 dim · focus 링.
   * - depth 슬라이더(1~2), 노드 클릭 = expand-on-demand(전체 이웃 펼침), ⌘+클릭 = 이 노트로 이동.
   * - "+N more" 배지 = 표시 안 된 이웃 수.
   */

  type FGNode = NodeObject & EgoNode;
  type FGLink = LinkObject<FGNode> & DocGraphEdge;

  let containerEl = $state<HTMLDivElement | null>(null);
  let fg = $state<ForceGraphType<FGNode, FGLink> | null>(null);
  let hoverId = $state<string | null>(null);

  const gs = $derived($graphView);

  // ego 데이터 — 모달 열림 + linkIndex + center + depth + expanded 의존 (hover는 미포함).
  const ego = $derived.by(() => {
    const idx = $linkIndex;
    if (!gs.open || !gs.centerPath || !idx) return null;
    return buildEgoGraph(idx, gs.centerPath, {
      depth: gs.depth,
      expanded: gs.expanded,
      vaultRoot: $vaultPath ?? "",
    });
  });

  // hover 강조용 무방향 인접.
  const adjacency = $derived.by(() => {
    const m = new Map<string, Set<string>>();
    if (!ego) return m;
    const link = (a: string, b: string) => {
      let s = m.get(a);
      if (!s) m.set(a, (s = new Set()));
      s.add(b);
    };
    for (const e of ego.edges) {
      link(e.source, e.target);
      link(e.target, e.source);
    }
    return m;
  });

  const centerLabel = $derived(
    ego?.nodes.find((n) => n.id === ego.center)?.label ?? "—",
  );

  // === 테마 색 (getComputedStyle로 CSS 토큰 읽기) ===
  let colors = {
    node: "#8a8f98",
    center: "#4a90d9",
    neighbor: "#1f2328",
    dim: "#d0d3d8",
    link: "#c2c6cc",
    linkHi: "#4a90d9",
    label: "#5a5f66",
  };
  function readColors() {
    if (!containerEl) return;
    const cs = getComputedStyle(containerEl);
    const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
    colors = {
      node: v("--text-muted", colors.node),
      center: v("--accent", colors.center),
      neighbor: v("--text-primary", colors.neighbor),
      dim: v("--border-default", colors.dim),
      link: v("--border-strong", colors.link),
      linkHi: v("--accent", colors.linkHi),
      label: v("--text-secondary", colors.label),
    };
  }

  function nodeRadius(n: FGNode): number {
    return 3 + Math.sqrt(n.degree ?? 0) * 1.5;
  }

  function nodeFill(n: FGNode): string {
    const isCenter = n.id === ego?.center;
    if (!hoverId) return isCenter ? colors.center : colors.node;
    if (n.id === hoverId) return colors.center;
    if (adjacency.get(hoverId)?.has(n.id)) return colors.neighbor;
    return colors.dim;
  }

  function shouldLabel(n: FGNode, scale: number): boolean {
    if (n.id === ego?.center) return true;
    if (hoverId && (n.id === hoverId || adjacency.get(hoverId)?.has(n.id))) return true;
    // 노드가 많으면(펼친 직후 등) 라벨 폭주 → hover/center만, 크게 확대했을 때만 노출.
    const total = ego?.nodes.length ?? 0;
    if (total > 60) return scale > 3;
    if (total > 30) return scale > 2;
    return scale > 1.4;
  }

  function drawNode(n: FGNode, ctx: CanvasRenderingContext2D, scale: number) {
    const x = n.x ?? 0;
    const y = n.y ?? 0;
    const r = nodeRadius(n);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = nodeFill(n);
    ctx.fill();

    if (n.id === ego?.center) {
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = colors.center;
      ctx.beginPath();
      ctx.arc(x, y, r + 3 / scale, 0, 2 * Math.PI);
      ctx.stroke();
    }

    if (shouldLabel(n, scale)) {
      const fontSize = 12 / scale;
      ctx.font = `${fontSize}px -apple-system, sans-serif`;
      ctx.fillStyle = colors.label;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(n.label, x + r + 3 / scale, y);
    }

    if ((n.hiddenNeighbors ?? 0) > 0) {
      const fontSize = 11 / scale;
      ctx.font = `bold ${fontSize}px -apple-system, sans-serif`;
      ctx.fillStyle = colors.center;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`+${n.hiddenNeighbors}`, x, y - r - 6 / scale);
    }
  }

  function linkColor(l: FGLink): string {
    if (!hoverId) return colors.link;
    const s = typeof l.source === "object" ? (l.source as FGNode).id : l.source;
    const t = typeof l.target === "object" ? (l.target as FGNode).id : l.target;
    return s === hoverId || t === hoverId ? colors.linkHi : colors.dim;
  }

  function onNodeClick(n: FGNode, ev: MouseEvent) {
    if (ev.metaKey || ev.ctrlKey) {
      void selectNote(n.id);
      recenterGraph(n.id);
    } else {
      toggleExpanded(n.id);
    }
  }

  function sizeToContainer() {
    if (fg && containerEl) {
      fg.width(containerEl.clientWidth).height(containerEl.clientHeight);
    }
  }

  // === force-graph 인스턴스 (동적 import — SSR 회피 + lazy) ===
  $effect(() => {
    if (!containerEl) return;
    let disposed = false;
    let inst: ForceGraphType<FGNode, FGLink> | null = null;
    void (async () => {
      const { default: ForceGraph } = await import("force-graph");
      if (disposed || !containerEl) return;
      readColors();
      inst = new ForceGraph<FGNode, FGLink>(containerEl)
        .nodeId("id")
        .linkSource("source")
        .linkTarget("target")
        .backgroundColor("rgba(0,0,0,0)")
        .nodeRelSize(4)
        .nodeVal((n) => 1 + (n.degree ?? 0))
        .nodeCanvasObjectMode(() => "replace")
        .nodeCanvasObject(drawNode)
        .nodeLabel((n) => n.label)
        .linkColor(linkColor)
        .linkWidth((l) => Math.min(4, 0.6 + (l.weight ?? 1) * 0.6))
        .onNodeHover((n) => {
          hoverId = (n as FGNode | null)?.id ?? null;
        })
        .onNodeClick(onNodeClick)
        .onBackgroundClick(() => {
          hoverId = null;
        })
        .cooldownTicks(120)
        .d3VelocityDecay(0.3);
      fg = inst;
      // 노드 분산 — 펼친 그래프에서 노드/라벨 겹침 완화. 강한 척력 + degree-aware 충돌 반경.
      inst.d3Force("charge", forceManyBody<FGNode>().strength(-180).distanceMax(420));
      inst.d3Force(
        "collide",
        forceCollide<FGNode>((n) => nodeRadius(n) + 18).iterations(2),
      );
      sizeToContainer();
    })();
    return () => {
      disposed = true;
      inst?._destructor?.();
      fg = null;
      hoverId = null;
    };
  });

  // 컨테이너 리사이즈 추적.
  $effect(() => {
    if (!containerEl) return;
    const ro = new ResizeObserver(() => sizeToContainer());
    ro.observe(containerEl);
    return () => ro.disconnect();
  });

  // 데이터 push — fg 준비 + ego 변경 시. force-graph가 좌표를 mutate하므로 복제 전달.
  let fitPending = false;
  $effect(() => {
    const data = ego;
    if (!fg) return;
    if (data) {
      fg.graphData({
        nodes: data.nodes.map((n) => ({ ...n })),
        links: data.edges.map((e) => ({ ...e })),
      });
      fitPending = true;
      setTimeout(() => {
        if (fitPending && fg) {
          fg.zoomToFit(400, 48);
          fitPending = false;
        }
      }, 350);
    } else {
      fg.graphData({ nodes: [], links: [] });
    }
  });

  // hover 변경 시 정지된 캔버스 강제 redraw (drawNode 재설정 → 내부 flush).
  $effect(() => {
    void hoverId;
    fg?.nodeCanvasObject(drawNode);
  });
</script>

{#if gs.open}
  <ModalShell onClose={closeGraph} label="Local graph">
    <div class="graph-modal" role="dialog" aria-modal="true" aria-label="Local graph">
      <header class="graph-head">
        <div class="title">
          <span class="kicker">Local Graph</span>
          <span class="center-name" title={centerLabel}>{centerLabel}</span>
        </div>
        <div class="controls">
          <label class="depth">
            <span>Depth</span>
            <input
              type="range"
              min={MIN_DEPTH}
              max={MAX_DEPTH}
              step="1"
              value={gs.depth}
              oninput={(e) => setGraphDepth(+e.currentTarget.value)}
            />
            <span class="depth-val">{gs.depth}</span>
          </label>
          <button
            class="btn btn--icon btn--sm btn--plain"
            data-autofocus
            onclick={closeGraph}
            title="닫기 (Esc)">×</button
          >
        </div>
      </header>

      <div class="graph-body">
        <div class="graph-canvas" bind:this={containerEl}></div>
        {#if ego && ego.nodes.length <= 1}
          <div class="empty">연결된 노트가 없습니다.</div>
        {/if}
      </div>

      <footer class="graph-foot">
        <span class="hint">클릭 = 이웃 펼치기 · ⌘+클릭 = 이 노트로 이동 · 드래그/스크롤 = 이동·확대</span>
        <span class="stat">
          {#if ego}
            {ego.nodes.length} notes · {ego.edges.length} links{#if ego.truncated} · 일부 생략됨{/if}
          {/if}
        </span>
      </footer>
    </div>
  </ModalShell>
{/if}

<style>
  .graph-modal {
    width: min(1320px, 92vw);
    height: min(900px, 88vh);
    display: flex;
    flex-direction: column;
    background: var(--surface-overlay);
    border: 1px solid var(--border-default);
    border-radius: var(--r-lg);
    overflow: hidden;
    box-shadow: var(--shadow-overlay);
    color: var(--text-primary);
  }

  .graph-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-4);
    padding: 10px var(--sp-6);
    background: var(--surface-overlay);
    border-bottom: 1px solid var(--border-default);
  }

  .title {
    display: flex;
    align-items: baseline;
    gap: var(--sp-4);
    min-width: 0;
  }

  .kicker {
    font-weight: 600;
    font-size: var(--fs-sm);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
    flex: none;
  }

  .center-name {
    font-size: var(--fs-base);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: var(--sp-5);
    flex: none;
  }

  .depth {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }

  .depth input[type="range"] {
    width: 80px;
    accent-color: var(--accent);
  }

  .depth-val {
    width: 1ch;
    text-align: center;
    color: var(--text-secondary);
  }

  .graph-body {
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--surface-base);
  }

  .graph-canvas {
    position: absolute;
    inset: 0;
  }

  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: var(--fs-sm);
    pointer-events: none;
  }

  .graph-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-4);
    padding: var(--sp-3) var(--sp-6);
    background: var(--surface-overlay);
    border-top: 1px solid var(--border-default);
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }

  .stat {
    flex: none;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .hint {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
