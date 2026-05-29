<script lang="ts">
  import { onMount } from "svelte";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";

  type Stage = "idle" | "running" | "done" | "error";

  interface CleanupProgress {
    stage: "starting" | "mirror" | "search-index" | "vault-orphans" | "done";
    message: string;
  }

  let stage = $state<Stage>("idle");
  let lastMessage = $state<string>("");
  let errorText = $state<string>("");
  let unlistens: UnlistenFn[] = [];

  onMount(() => {
    void (async () => {
      const u1 = await listen<CleanupProgress>("cleanup-progress", (e) => {
        if (e.payload.stage === "starting") stage = "running";
        else if (e.payload.stage === "done") {
          stage = "done";
          // 1.5초 보여주고 닫음
          setTimeout(() => {
            stage = "idle";
          }, 1500);
        } else {
          stage = "running";
        }
        lastMessage = e.payload.message;
      });
      const u2 = await listen<string>("cleanup-error", (e) => {
        stage = "error";
        errorText = e.payload;
      });
      unlistens = [u1, u2];
    })();
    return () => {
      for (const u of unlistens) u();
    };
  });

  function dismissError() {
    stage = "idle";
    errorText = "";
  }
</script>

{#if stage !== "idle"}
  <div class="cleanup-backdrop" role="status" aria-live="polite">
    <div class="cleanup-card">
      {#if stage === "running"}
        <div class="spinner" aria-hidden="true"></div>
        <div class="text">
          <div class="title">이전 메모리 데이터 정리 중…</div>
          <div class="detail">{lastMessage || "잠시만 기다려 주세요."}</div>
        </div>
      {:else if stage === "done"}
        <div class="check" aria-hidden="true">✓</div>
        <div class="text">
          <div class="title">정리 완료</div>
          <div class="detail">claude-mem 통합이 비활성화되었습니다.</div>
        </div>
      {:else if stage === "error"}
        <div class="warn" aria-hidden="true">⚠</div>
        <div class="text">
          <div class="title">정리 중 오류</div>
          <div class="detail">{errorText}</div>
          <button class="dismiss" onclick={dismissError}>닫기</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .cleanup-backdrop {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 980;
  }
  .cleanup-card {
    display: flex;
    align-items: center;
    gap: 14px;
    background: var(--surface-overlay);
    border: 1px solid var(--border-default);
    border-radius: var(--r-lg);
    padding: 18px 22px;
    box-shadow: var(--shadow-overlay);
    max-width: 440px;
  }
  .spinner {
    width: 22px;
    height: 22px;
    border: 2px solid var(--border-subtle);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .check {
    color: var(--success);
    font-size: 22px;
    font-weight: 700;
  }
  .warn {
    color: var(--warning);
    font-size: 22px;
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .title {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .detail {
    font-size: 11.5px;
    color: var(--text-muted);
    line-height: 1.5;
  }
  .dismiss {
    margin-top: 8px;
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--text-secondary);
    border-radius: var(--r-sm);
    padding: 4px 10px;
    font-size: var(--fs-xs);
    cursor: pointer;
    align-self: flex-start;
  }
  .dismiss:hover {
    border-color: var(--accent);
  }
</style>
