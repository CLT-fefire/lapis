<script lang="ts">
  import { memorySyncOpen, closeMemorySync } from "$lib/stores/memorySync";
  import { vaultPath, reloadNotes } from "$lib/stores/vault";
  import { loadVaultConfig } from "$lib/vaultConfig";
  import {
    memoryPreviewExport,
    memoryExportToVault,
    type PreviewReport,
    type ExportReport,
  } from "$lib/tauri/memory";

  type Stage = "preview-loading" | "confirm" | "exporting" | "done" | "error";

  let stage: Stage = $state("preview-loading");
  let preview: PreviewReport | null = $state(null);
  let report: ExportReport | null = $state(null);
  let projectsFilter: string[] = $state([]);
  let errorMessage = $state("");

  // 모달 열릴 때마다 preview 자동 로드
  $effect(() => {
    if (!$memorySyncOpen) return;
    void runPreview();
  });

  async function runPreview() {
    const vault = $vaultPath;
    if (!vault) {
      stage = "error";
      errorMessage = "vault를 먼저 열어주세요.";
      return;
    }
    stage = "preview-loading";
    preview = null;
    report = null;
    errorMessage = "";
    try {
      const config = await loadVaultConfig(vault);
      projectsFilter = config.mem_projects;
      preview = await memoryPreviewExport(vault, projectsFilter);
      stage = "confirm";
    } catch (e) {
      stage = "error";
      errorMessage = `미리보기 실패: ${e}`;
    }
  }

  async function runExport() {
    const vault = $vaultPath;
    if (!vault) {
      stage = "error";
      errorMessage = "vault가 닫혔습니다.";
      return;
    }
    stage = "exporting";
    try {
      report = await memoryExportToVault(vault, projectsFilter);
      stage = "done";
      // vault 트리 갱신 (새 _memories/ 폴더 surface)
      void reloadNotes();
    } catch (e) {
      stage = "error";
      errorMessage = `export 실패: ${e}`;
    }
  }

  function close() {
    closeMemorySync();
    // 다음 열릴 때 초기 상태로 — $effect가 새로 preview 호출하니 stage 등은 자동 리셋되지만
    // 모달 닫힐 때 명시적으로 정리.
    stage = "preview-loading";
    preview = null;
    report = null;
    errorMessage = "";
  }

  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget && stage !== "exporting") close();
  }

  function projectsLabel(filter: string[]): string {
    if (filter.length === 0 || filter.includes("*")) return "전체 프로젝트";
    return filter.join(", ");
  }
</script>

{#if $memorySyncOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={onBackdrop}>
    <div class="modal" role="dialog" aria-modal="true">
      <header>
        <span class="title">Memory · Sync</span>
        {#if stage !== "exporting"}
          <button class="close" onclick={close} aria-label="닫기">✕</button>
        {/if}
      </header>

      <div class="body">
        {#if stage === "preview-loading"}
          <p>claude-mem DB 조회 중…</p>
          <p class="hint">vault 매핑: {projectsLabel(projectsFilter)}</p>
        {:else if stage === "confirm" && preview}
          <p>
            대상 <strong>{preview.total_candidates}</strong>개 (vault 매핑: {projectsLabel(projectsFilter)})
          </p>
          <ul class="counts">
            <li>신규 생성 예정: <strong class="new">{preview.new_count}</strong>개</li>
            <li>이미 export됨 (skip): {preview.already_exported}개</li>
          </ul>
          {#if preview.new_count === 0}
            <p class="info">신규 export 대상이 없습니다.</p>
          {:else}
            <p class="hint">
              새 노트는 <code>_memories/YYYY-MM/</code> 폴더에 생성됩니다. 기존 노트는 보존(skip).
            </p>
          {/if}
        {:else if stage === "exporting"}
          <p>Export 중… (DB → vault 파일 쓰기)</p>
          <p class="hint">대량의 메모리는 수 초~수십 초 걸릴 수 있습니다.</p>
        {:else if stage === "done" && report}
          <p>완료.</p>
          <ul class="counts">
            <li>신규 생성: <strong class="new">{report.created}</strong>개</li>
            <li>Skip: {report.skipped}개</li>
            {#if report.errors.length > 0}
              <li class="err">에러: {report.errors.length}건</li>
            {/if}
          </ul>
          {#if report.errors.length > 0}
            <details>
              <summary>에러 상세</summary>
              <pre>{report.errors.slice(0, 20).join("\n")}{report.errors.length > 20 ? "\n…" : ""}</pre>
            </details>
          {/if}
        {:else if stage === "error"}
          <p class="err">{errorMessage}</p>
        {/if}
      </div>

      <footer>
        {#if stage === "confirm"}
          <button class="btn" onclick={close}>취소</button>
          <button
            class="btn primary"
            onclick={runExport}
            disabled={preview ? preview.new_count === 0 : true}
          >
            Sync 시작
          </button>
        {:else if stage === "done"}
          <button class="btn primary" onclick={close}>닫기</button>
        {:else if stage === "error"}
          <button class="btn" onclick={close}>닫기</button>
          <button class="btn primary" onclick={runPreview}>다시 시도</button>
        {/if}
      </footer>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
    padding: 32px;
  }

  .modal {
    width: min(520px, 92vw);
    background: #1f1f1f;
    border: 1px solid #3a3a3a;
    border-radius: 10px;
    color: #e8e8e8;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
  }

  header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid #333;
  }

  .title {
    font-weight: 600;
    color: #6dd6ff;
  }

  .close {
    margin-left: auto;
    background: transparent;
    border: none;
    color: #777;
    font-size: 14px;
    cursor: pointer;
    padding: 4px 8px;
  }

  .close:hover {
    color: #e8e8e8;
  }

  .body {
    padding: 16px;
    font-size: 13px;
    line-height: 1.6;
  }

  .body p {
    margin: 0 0 8px;
  }

  .body .hint {
    color: #888;
    font-size: 12px;
  }

  .body .info {
    color: #f7c947;
  }

  .body .err {
    color: #f47174;
  }

  .counts {
    list-style: none;
    padding: 0;
    margin: 8px 0;
  }

  .counts li {
    padding: 4px 0;
  }

  .counts .new {
    color: #6dd6ff;
  }

  details {
    margin-top: 10px;
    font-size: 12px;
  }

  details summary {
    cursor: pointer;
    color: #aaa;
  }

  pre {
    background: #111;
    border: 1px solid #2a2a2a;
    border-radius: 6px;
    padding: 8px;
    overflow: auto;
    max-height: 180px;
    color: #d0d0d0;
    font-size: 11px;
  }

  code {
    background: #2a2a2a;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 11px;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid #333;
  }

  .btn {
    padding: 6px 14px;
    background: transparent;
    border: 1px solid #444;
    border-radius: 5px;
    color: #e8e8e8;
    font-size: 12px;
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    background: #2c2c2c;
    border-color: #555;
  }

  .btn.primary {
    background: rgba(109, 214, 255, 0.12);
    border-color: rgba(109, 214, 255, 0.5);
    color: #6dd6ff;
  }

  .btn.primary:hover:not(:disabled) {
    background: rgba(109, 214, 255, 0.2);
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
