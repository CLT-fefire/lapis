<script lang="ts">
  import ModalShell from "$lib/ModalShell.svelte";
  import {
    graphView,
    closeGraph,
    setGraphDepth,
    toggleExpanded,
    setGraphMode,
    setGraphColorMode,
    setGraphSizeMode,
    setGraphFilters,
    toggleGraphType,
    MIN_DEPTH,
    MAX_DEPTH,
    type GraphColorMode,
  } from "$lib/stores/graph";
  import { linkIndex, vaultPath, selectNote } from "$lib/stores/vault";
  import { buildEgoGraph } from "$lib/egoGraph";
  import {
    buildDocumentGraph,
    filterDocGraph,
    computeBetweenness,
    projectOf,
    type DocGraphNode,
    type DocGraphEdge,
  } from "$lib/documentGraph";
  import { forceManyBody, forceCollide, forceX, forceY } from "d3-force";
  import type ForceGraphType from "force-graph";
  import type { NodeObject, LinkObject } from "force-graph";

  /**
   * 그래프 모달 (ADR-003). 두 모드:
   * - **Local/ego**(G2′): 현재 노트 이웃. depth + expand-on-demand + hover.
   * - **Global**(G3′): 현재 노트의 프로젝트 스코프 풀스택. community 색 + per-community
   *   클러스터힘 + 필터(고아/min-weight 백본/degree-cap) + 색 3-way 토글.
   * 데이터는 순수(egoGraph/documentGraph, vitest). 렌더/인터랙션은 사용자 dev 육안검증.
   */

  type FGNode = NodeObject & DocGraphNode & { depth?: number; hiddenNeighbors?: number };
  type FGLink = LinkObject<FGNode> & DocGraphEdge;

  // 색맹 안전 팔레트(Okabe-Ito) + 8색 초과 중립.
  const OKABE_ITO = [
    "#0072B2",
    "#E69F00",
    "#009E73",
    "#CC79A7",
    "#56B4E9",
    "#D55E00",
    "#F0E442",
    "#999999",
  ];
  const NEUTRAL = "#9aa0a8";
  const NODE_WARN = 150;

  let containerEl = $state<HTMLDivElement | null>(null);
  let fg = $state<ForceGraphType<FGNode, FGLink> | null>(null);
  let hoverId = $state<string | null>(null);

  const gs = $derived($graphView);

  // Global 베이스 그래프 — center/mode/scope에만 의존(필터 무관 → 필터 바꿔도 재빌드 X).
  const globalBase = $derived.by(() => {
    const idx = $linkIndex;
    if (!gs.open || gs.mode !== "global" || !gs.centerPath || !idx) return null;
    const root = $vaultPath ?? "";
    const proj = projectOf(gs.centerPath, root);
    return buildDocumentGraph(idx, {
      vaultRoot: root,
      scopeFolders: proj ? [proj] : undefined,
    });
  });

  // 표시 데이터 — local: ego, global: filterDocGraph(globalBase). 통일 {nodes,edges,...}.
  const view = $derived.by(() => {
    const idx = $linkIndex;
    if (!gs.open || !gs.centerPath || !idx) return null;
    if (gs.mode === "local") {
      const ego = buildEgoGraph(idx, gs.centerPath, {
        depth: gs.depth,
        expanded: gs.expanded,
        vaultRoot: $vaultPath ?? "",
      });
      return {
        nodes: ego.nodes as DocGraphNode[],
        edges: ego.edges,
        total: ego.nodes.length,
        shown: ego.nodes.length,
        truncated: ego.truncated,
      };
    }
    if (!globalBase) return null;
    const f = filterDocGraph(globalBase, {
      ...gs.filters,
      types: gs.filters.types.length > 0 ? new Set(gs.filters.types) : null,
    });
    return {
      nodes: f.nodes,
      edges: f.edges,
      total: f.totalNodes,
      shown: f.shownNodes,
      truncated: false,
    };
  });

  // hover 강조용 무방향 인접.
  const adjacency = $derived.by(() => {
    const m = new Map<string, Set<string>>();
    if (!view) return m;
    const link = (a: string, b: string) => {
      let s = m.get(a);
      if (!s) m.set(a, (s = new Set()));
      s.add(b);
    };
    for (const e of view.edges) {
      link(e.source, e.target);
      link(e.target, e.source);
    }
    return m;
  });

  // [global] folder/type 값 → 색(정렬 안정, 8색 초과 중립). community는 번호로 직접.
  const colorMap = $derived.by(() => {
    const m = new Map<string, string>();
    if (gs.mode !== "global" || !view || gs.colorMode === "community") return m;
    const vals = new Set<string>();
    for (const n of view.nodes) {
      const v = gs.colorMode === "folder" ? n.folder : n.type;
      if (v) vals.add(v);
    }
    [...vals].sort().forEach((v, i) => m.set(v, i < OKABE_ITO.length ? OKABE_ITO[i] : NEUTRAL));
    return m;
  });

  // [global] per-community 클러스터 개수.
  const communityCount = $derived(
    gs.mode === "global" && view
      ? view.nodes.reduce((mx, n) => Math.max(mx, n.community ?? 0), 0) + 1
      : 1,
  );

  // PageRank 크기 정규화용 max.
  const maxPagerank = $derived(
    gs.mode === "global" && view
      ? view.nodes.reduce((mx, n) => Math.max(mx, n.pagerank ?? 0), 0)
      : 0,
  );

  // betweenness("다리 노트") — 온디맨드. 크기 토글이 betweenness이고 global일 때만 계산.
  // 전체(globalBase) 그래프 기준(필터해도 중심성은 전역값 유지 — degree/PageRank와 일관).
  const betweennessMap = $derived.by(() => {
    if (gs.mode !== "global" || gs.sizeMode !== "betweenness" || !globalBase) return null;
    return computeBetweenness(globalBase.graph);
  });
  const maxBetweenness = $derived(
    betweennessMap
      ? Object.values(betweennessMap).reduce((mx, v) => Math.max(mx, v), 0)
      : 0,
  );

  // [global] 프로젝트 스코프의 type(doc_kind) 분포 — 필터 칩. globalBase(필터 전) 기준이라
  // type 필터로 숨겨도 칩은 유지되어 다시 켤 수 있다. count 내림차순.
  const availableTypes = $derived.by(() => {
    if (gs.mode !== "global" || !globalBase) return [] as [string, number][];
    const counts = new Map<string, number>();
    for (const n of globalBase.nodes) {
      if (n.type) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  });

  // [global] 색 범례 — community는 색 칩(#i), folder/type은 값-색 매핑(상위 8).
  const legend = $derived.by(() => {
    const out: { label: string; color: string }[] = [];
    if (gs.mode !== "global" || !view) return out;
    if (gs.colorMode === "community") {
      const n = Math.min(communityCount, OKABE_ITO.length);
      for (let i = 0; i < n; i++) out.push({ label: `#${i}`, color: OKABE_ITO[i] });
    } else {
      for (const [v, c] of [...colorMap.entries()].slice(0, OKABE_ITO.length)) {
        out.push({ label: v, color: c });
      }
    }
    return out;
  });

  const centerLabel = $derived(
    view?.nodes.find((n) => n.id === gs.centerPath)?.label ??
      gs.centerPath?.split("/").pop()?.replace(/\.md$/, "") ??
      "—",
  );
  const projectName = $derived(projectOf(gs.centerPath ?? "", $vaultPath ?? "") ?? "(루트)");

  // === 테마 색 ===
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
    if (gs.mode === "global") {
      if (gs.sizeMode === "pagerank") {
        const mx = maxPagerank || 1;
        return 3 + Math.sqrt((n.pagerank ?? 0) / mx) * 9;
      }
      if (gs.sizeMode === "betweenness" && betweennessMap) {
        const mx = maxBetweenness || 1;
        return 3 + Math.sqrt((betweennessMap[n.id] ?? 0) / mx) * 9;
      }
    }
    return 3 + Math.sqrt(n.degree ?? 0) * 1.5;
  }

  function baseFill(n: FGNode): string {
    if (gs.mode === "local") return n.id === gs.centerPath ? colors.center : colors.node;
    if (gs.colorMode === "community") {
      return OKABE_ITO[(n.community ?? 0) % OKABE_ITO.length];
    }
    const v = gs.colorMode === "folder" ? n.folder : n.type;
    return (v && colorMap.get(v)) || NEUTRAL;
  }

  function nodeFill(n: FGNode): string {
    if (!hoverId) return baseFill(n);
    if (n.id === hoverId) return colors.center;
    if (adjacency.get(hoverId)?.has(n.id)) return baseFill(n);
    return colors.dim;
  }

  function shouldLabel(n: FGNode, scale: number): boolean {
    if (n.id === gs.centerPath) return true;
    if (hoverId && (n.id === hoverId || adjacency.get(hoverId)?.has(n.id))) return true;
    const total = view?.nodes.length ?? 0;
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

    if (n.id === gs.centerPath) {
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
    // ⌥(Alt)+클릭(local) = 이웃 펼치기(탐색 유지). 그 외 클릭 = 그 노트로 이동 + 모달 닫기.
    if (ev.altKey && gs.mode === "local") {
      toggleExpanded(n.id);
      return;
    }
    void selectNote(n.id);
    closeGraph();
  }

  function sizeToContainer() {
    if (fg && containerEl) {
      fg.width(containerEl.clientWidth).height(containerEl.clientHeight);
    }
  }

  // === force-graph 인스턴스 (동적 import) ===
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
        .cooldownTicks(140)
        .d3VelocityDecay(0.3);
      fg = inst;
      inst.d3Force("charge", forceManyBody<FGNode>().strength(-180).distanceMax(420));
      inst.d3Force("collide", forceCollide<FGNode>((n) => nodeRadius(n) + 18).iterations(2));
      sizeToContainer();
    })();
    return () => {
      disposed = true;
      inst?._destructor?.();
      fg = null;
      hoverId = null;
    };
  });

  $effect(() => {
    if (!containerEl) return;
    const ro = new ResizeObserver(() => sizeToContainer());
    ro.observe(containerEl);
    return () => ro.disconnect();
  });

  // 데이터 push — fg 준비 + view 변경 시.
  let fitPending = false;
  $effect(() => {
    const data = view;
    if (!fg) return;
    if (data) {
      fg.graphData({
        nodes: data.nodes.map((n) => ({ ...n }) as FGNode),
        links: data.edges.map((e) => ({ ...e }) as FGLink),
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

  // [global] per-community 클러스터힘 — community 별자리. local이면 해제.
  $effect(() => {
    if (!fg) return;
    if (gs.mode === "global" && view && view.nodes.length > 0) {
      const count = communityCount;
      const radius = 80 + count * 28;
      const cx = (c: number) => radius * Math.cos((2 * Math.PI * c) / count);
      const cy = (c: number) => radius * Math.sin((2 * Math.PI * c) / count);
      fg.d3Force("x", forceX<FGNode>((n) => cx(n.community ?? 0)).strength(0.14));
      fg.d3Force("y", forceY<FGNode>((n) => cy(n.community ?? 0)).strength(0.14));
    } else {
      fg.d3Force("x", null);
      fg.d3Force("y", null);
    }
    fg.d3ReheatSimulation();
  });

  // hover 변경 시 정지된 캔버스 강제 redraw.
  $effect(() => {
    void hoverId;
    fg?.nodeCanvasObject(drawNode);
  });

  // 크기 기준(degree↔PageRank) 변경 시 collide 반경 재초기화 + 재배치.
  $effect(() => {
    void gs.sizeMode;
    fg?.d3ReheatSimulation();
  });

  const COLOR_MODES: { key: GraphColorMode; label: string }[] = [
    { key: "community", label: "커뮤니티" },
    { key: "folder", label: "폴더" },
    { key: "type", label: "타입" },
  ];
</script>

{#if gs.open}
  <ModalShell onClose={closeGraph} label="Graph">
    <div class="graph-modal" role="dialog" aria-modal="true" aria-label="Graph">
      <header class="graph-head">
        <div class="title">
          <div class="seg" role="tablist" aria-label="그래프 모드">
            <button
              class="seg-btn"
              class:active={gs.mode === "local"}
              onclick={() => setGraphMode("local")}
              title="현재 노트 이웃">Local</button
            >
            <button
              class="seg-btn"
              class:active={gs.mode === "global"}
              onclick={() => setGraphMode("global")}
              title="프로젝트 전체">Global</button
            >
          </div>
          <span class="center-name" title={gs.mode === "global" ? projectName : centerLabel}>
            {gs.mode === "global" ? projectName : centerLabel}
          </span>
        </div>

        <div class="controls">
          {#if gs.mode === "local"}
            <label class="ctl">
              <span>Depth</span>
              <input
                type="range"
                min={MIN_DEPTH}
                max={MAX_DEPTH}
                step="1"
                value={gs.depth}
                oninput={(e) => setGraphDepth(+e.currentTarget.value)}
              />
              <span class="val">{gs.depth}</span>
            </label>
          {:else}
            <div class="seg seg--sm" role="group" aria-label="색 기준">
              {#each COLOR_MODES as cm}
                <button
                  class="seg-btn"
                  class:active={gs.colorMode === cm.key}
                  onclick={() => setGraphColorMode(cm.key)}>{cm.label}</button
                >
              {/each}
            </div>
          {/if}
          <button
            class="btn btn--icon btn--sm btn--plain"
            data-autofocus
            onclick={closeGraph}
            title="닫기 (Esc)">×</button
          >
        </div>
      </header>

      {#if gs.mode === "global"}
        <div class="filters">
          <label class="chk">
            <input
              type="checkbox"
              checked={gs.filters.hideOrphans}
              onchange={(e) => setGraphFilters({ hideOrphans: e.currentTarget.checked })}
            />
            고아 숨김
          </label>
          <div class="size-toggle">
            <span>백본</span>
            <div class="seg seg--sm" role="group" aria-label="백본 방식">
              <button
                class="seg-btn"
                class:active={gs.filters.backboneMode === "minWeight"}
                onclick={() => setGraphFilters({ backboneMode: "minWeight" })}
                title="전역 최소 연결강도로 약한 엣지 제거">강도</button
              >
              <button
                class="seg-btn"
                class:active={gs.filters.backboneMode === "disparity"}
                onclick={() => setGraphFilters({ backboneMode: "disparity" })}
                title="disparity filter — 노드별 weight 분포로 통계적으로 유의한 엣지만">disparity</button
              >
            </div>
          </div>
          {#if gs.filters.backboneMode === "minWeight"}
            <label class="ctl">
              <span>최소 연결강도</span>
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={gs.filters.minWeight}
                oninput={(e) => setGraphFilters({ minWeight: +e.currentTarget.value })}
              />
              <span class="val">{gs.filters.minWeight}</span>
            </label>
          {:else}
            <label class="ctl">
              <span title="작을수록 백본이 sparse(엄격)">α</span>
              <input
                type="range"
                min="0.05"
                max="0.6"
                step="0.05"
                value={gs.filters.disparityAlpha}
                oninput={(e) => setGraphFilters({ disparityAlpha: +e.currentTarget.value })}
              />
              <span class="val">{gs.filters.disparityAlpha.toFixed(2)}</span>
            </label>
          {/if}
          <label class="ctl">
            <span>허브 숨김(degree&gt;)</span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={gs.filters.degreeCap ?? 0}
              oninput={(e) => {
                const v = +e.currentTarget.value;
                setGraphFilters({ degreeCap: v === 0 ? null : v });
              }}
            />
            <span class="val">{gs.filters.degreeCap ?? "off"}</span>
          </label>
          <div class="size-toggle">
            <span>크기</span>
            <div class="seg seg--sm" role="group" aria-label="크기 기준">
              <button
                class="seg-btn"
                class:active={gs.sizeMode === "degree"}
                onclick={() => setGraphSizeMode("degree")}
                title="연결 수(degree)">연결수</button
              >
              <button
                class="seg-btn"
                class:active={gs.sizeMode === "pagerank"}
                onclick={() => setGraphSizeMode("pagerank")}
                title="PageRank(영향력)">PageRank</button
              >
              <button
                class="seg-btn"
                class:active={gs.sizeMode === "betweenness"}
                onclick={() => setGraphSizeMode("betweenness")}
                title="betweenness(군집을 잇는 다리 노트)">다리</button
              >
            </div>
          </div>
          {#if availableTypes.length > 0}
            <div class="type-filter">
              <span>type</span>
              {#each availableTypes as [t, c] (t)}
                <button
                  class="chip"
                  class:active={gs.filters.types.includes(t)}
                  onclick={() => toggleGraphType(t)}
                  title="{t} · {c}개{gs.filters.types.length > 0 ? '' : ' (전체 표시 중)'}"
                  >{t}<span class="chip-count">{c}</span></button
                >
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <div class="graph-body">
        <div class="graph-canvas" bind:this={containerEl}></div>
        {#if view && view.nodes.length <= 1}
          <div class="overlay">
            {gs.mode === "global" ? "표시할 노트가 없습니다 — 필터를 완화하세요." : "연결된 노트가 없습니다."}
          </div>
        {:else if gs.mode === "global" && view && view.shown > NODE_WARN}
          <div class="warn">
            노드 {view.shown}개 — 거미줄이 될 수 있습니다. 필터(고아·연결강도·허브)를 조이거나
            <button class="linkbtn" onclick={() => setGraphMode("local")}>Local 모드</button>를 권장합니다.
          </div>
        {/if}
        {#if gs.mode === "global" && legend.length > 0}
          <div class="legend" aria-label="색 범례">
            {#each legend as item (item.label)}
              <span class="legend-item">
                <span class="legend-dot" style="background:{item.color}"></span>
                <span class="legend-label" title={item.label}>{item.label}</span>
              </span>
            {/each}
          </div>
        {/if}
      </div>

      <footer class="graph-foot">
        <span class="hint">
          {#if gs.mode === "local"}
            클릭 = 노트 열기 · ⌥+클릭 = 이웃 펼치기
          {:else}
            클릭 = 노트 열기 · 색 = {COLOR_MODES.find((c) => c.key === gs.colorMode)?.label}
          {/if}
          · 드래그/스크롤 = 이동·확대
        </span>
        <span class="stat">
          {#if view}
            {#if gs.mode === "global"}{view.shown}/{view.total}{:else}{view.shown}{/if} notes · {view.edges.length} links{#if view.truncated} · 일부 생략{/if}
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
    align-items: center;
    gap: var(--sp-4);
    min-width: 0;
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

  .seg {
    display: inline-flex;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-sm);
    overflow: hidden;
  }

  .seg-btn {
    appearance: none;
    border: none;
    background: var(--surface-base);
    color: var(--text-muted);
    font-size: var(--fs-sm);
    padding: var(--sp-2) 10px;
    cursor: pointer;
  }

  .seg-btn + .seg-btn {
    border-left: 1px solid var(--border-strong);
  }

  .seg-btn.active {
    background: var(--accent);
    color: #fff;
  }

  .seg--sm .seg-btn {
    padding: 3px var(--sp-3);
  }

  .ctl {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    font-size: var(--fs-sm);
    color: var(--text-muted);
  }

  .ctl input[type="range"] {
    width: 96px;
    accent-color: var(--accent);
  }

  .val {
    min-width: 2.4ch;
    text-align: center;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .filters {
    display: flex;
    align-items: center;
    gap: var(--sp-6);
    padding: var(--sp-3) var(--sp-6);
    background: var(--surface-base);
    border-bottom: 1px solid var(--border-default);
    font-size: var(--fs-sm);
    color: var(--text-muted);
    flex-wrap: wrap;
  }

  .chk {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    cursor: pointer;
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

  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: var(--fs-sm);
    pointer-events: none;
  }

  .warn {
    position: absolute;
    top: var(--sp-4);
    left: 50%;
    transform: translateX(-50%);
    max-width: 90%;
    padding: var(--sp-3) var(--sp-5);
    background: var(--surface-overlay);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-sm);
    box-shadow: var(--shadow-overlay);
    font-size: var(--fs-sm);
    color: var(--text-secondary);
  }

  .linkbtn {
    appearance: none;
    border: none;
    background: none;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    font: inherit;
    text-decoration: underline;
  }

  .size-toggle {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }

  .type-filter {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    flex-wrap: wrap;
  }

  .chip {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-lg);
    background: var(--surface-base);
    color: var(--text-muted);
    font-size: var(--fs-sm);
    padding: 2px var(--sp-3);
    cursor: pointer;
  }

  .chip:hover {
    border-color: var(--accent);
    color: var(--text-secondary);
  }

  .chip.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .chip-count {
    font-variant-numeric: tabular-nums;
    opacity: 0.7;
    font-size: var(--fs-xs);
  }

  .legend {
    position: absolute;
    left: var(--sp-4);
    bottom: var(--sp-4);
    max-width: 38%;
    max-height: 46%;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: var(--sp-3) var(--sp-4);
    background: var(--surface-overlay);
    border: 1px solid var(--border-default);
    border-radius: var(--r-sm);
    box-shadow: var(--shadow-overlay);
    font-size: var(--fs-sm);
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-width: 0;
  }

  .legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: none;
  }

  .legend-label {
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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

  .hint {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stat {
    flex: none;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
</style>
