<script lang="ts">
  import { graphOpen, closeGraph } from "$lib/stores/graph";

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
    <div class="graph-modal" role="dialog" aria-modal="true" aria-label="Graph view — coming back better">
      <header class="graph-head">
        <span class="title">Graph</span>
        <button class="close-btn" title="닫기 (Esc)" onclick={closeGraph}>×</button>
      </header>
      <div class="graph-body">
        <div class="placeholder">
          <div class="emoji" aria-hidden="true">🕸</div>
          <h2>그래프 기능은 잠시 쉬는 중입니다</h2>
          <p class="lead">
            현재 그래프는 1000+ 노트와 10000+ 메모리 환경에서<br />
            hairball 시각화에 그쳐 키워드 검색보다 느립니다.
          </p>
          <p class="lead">
            <strong>Level-of-Detail · Filter-First · Sub-graph 분리</strong>로<br />
            다시 돌아옵니다. 그때까지는 <kbd>⌘K</kbd> 키워드 검색이 더 빠릅니다.
          </p>
          <div class="actions">
            <button class="primary-btn" onclick={closeGraph}>확인</button>
          </div>
        </div>
      </div>
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
    max-width: 520px;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 10px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    color: #e8e8e8;
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
    flex: 1;
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
    padding: 28px 32px 32px;
    background: #1a1a1a;
  }

  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 14px;
  }

  .emoji {
    font-size: 36px;
    opacity: 0.7;
    margin-bottom: 2px;
  }

  .placeholder h2 {
    font-size: 16px;
    font-weight: 600;
    color: #e8e8e8;
    margin: 0;
  }

  .lead {
    margin: 0;
    color: #aaa;
    font-size: 13px;
    line-height: 1.6;
  }

  .lead strong {
    color: #6dd6ff;
    font-weight: 600;
  }

  kbd {
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 1px 6px;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 11px;
    color: #ddd;
  }

  .actions {
    margin-top: 8px;
  }

  .primary-btn {
    background: #2d4a5a;
    border: 1px solid #6dd6ff;
    color: #6dd6ff;
    padding: 6px 22px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
    transition: background 0.1s, color 0.1s;
  }

  .primary-btn:hover {
    background: #6dd6ff;
    color: #1a1a1a;
  }
</style>
