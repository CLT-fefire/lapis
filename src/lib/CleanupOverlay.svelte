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
    background: rgba(15, 15, 15, 0.82);
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
    background: #232323;
    border: 1px solid #3a3a3a;
    border-radius: 10px;
    padding: 18px 22px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.55);
    max-width: 440px;
  }
  .spinner {
    width: 22px;
    height: 22px;
    border: 2px solid #2a2a2a;
    border-top-color: #6dd6ff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .check {
    color: #5ad469;
    font-size: 22px;
    font-weight: 700;
  }
  .warn {
    color: #f7c947;
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
    color: #e8e8e8;
  }
  .detail {
    font-size: 11.5px;
    color: #999;
    line-height: 1.5;
  }
  .dismiss {
    margin-top: 8px;
    background: transparent;
    border: 1px solid #444;
    color: #ddd;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 11px;
    cursor: pointer;
    align-self: flex-start;
  }
  .dismiss:hover {
    border-color: #6dd6ff;
  }
</style>
