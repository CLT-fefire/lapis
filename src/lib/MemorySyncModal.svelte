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

  // 체크박스 — vault config의 default를 초기값으로 두고 사용자가 모달 안에서 일회성 override 가능.
  let includeSummaries = $state(true);
  let includeObservations = $state(false);

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
      includeSummaries = config.mem_session_summaries;
      includeObservations = config.mem_observations;
      preview = await memoryPreviewExport(
        vault,
        projectsFilter,
        includeSummaries,
        includeObservations,
      );
      stage = "confirm";
    } catch (e) {
      stage = "error";
      errorMessage = `미리보기 실패: ${e}`;
    }
  }

  /** 체크박스 토글 시 preview 카운트 재계산 (vault 스캔 비용은 ~수십ms). */
  async function refreshPreview() {
    const vault = $vaultPath;
    if (!vault || stage !== "confirm") return;
    try {
      preview = await memoryPreviewExport(
        vault,
        projectsFilter,
        includeSummaries,
        includeObservations,
      );
    } catch (e) {
      stage = "error";
      errorMessage = `미리보기 갱신 실패: ${e}`;
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
      report = await memoryExportToVault(
        vault,
        projectsFilter,
        includeSummaries,
        includeObservations,
      );
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

  /** preview 단계 — 둘 다 신규 0이거나 둘 다 비활성이면 export 버튼 disable */
  function nothingToExport(p: PreviewReport | null): boolean {
    if (!p) return true;
    const total = p.summaries.new_count + p.observations.new_count;
    return total === 0;
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
          <p class="hint">vault 매핑: {projectsLabel(projectsFilter)}</p>
          <ul class="counts">
            <li>
              <span class="kind summary">Session summaries</span>
              대상 <strong>{preview.summaries.total_candidates}</strong> ·
              신규 <strong class="new">{preview.summaries.new_count}</strong> ·
              skip {preview.summaries.already_exported}
            </li>
            <li>
              <span class="kind obs">Observations</span>
              대상 <strong>{preview.observations.total_candidates}</strong> ·
              신규 <strong class="new">{preview.observations.new_count}</strong> ·
              skip {preview.observations.already_exported}
            </li>
          </ul>
          <div class="toggles">
            <label>
              <input
                type="checkbox"
                bind:checked={includeSummaries}
                onchange={refreshPreview}
              />
              session_summaries 포함
            </label>
            <label>
              <input
                type="checkbox"
                bind:checked={includeObservations}
                onchange={refreshPreview}
              />
              observations 포함
            </label>
          </div>
          {#if nothingToExport(preview)}
            <p class="info">신규 export 대상이 없습니다.</p>
          {:else}
            <p class="hint">
              Summaries → <code>_memories/YYYY-MM/</code>,
              observations → <code>_memories/observations/YYYY-MM/</code>. 기존 노트 보존.
            </p>
          {/if}
        {:else if stage === "exporting"}
          <p>Export 중… (DB → vault 파일 쓰기)</p>
          <p class="hint">10000+ observations는 수십 초 걸릴 수 있습니다.</p>
        {:else if stage === "done" && report}
          <p>완료.</p>
          <ul class="counts">
            <li>
              <span class="kind summary">Session summaries</span>
              신규 <strong class="new">{report.summaries.created}</strong> ·
              skip {report.summaries.skipped}
              {#if report.summaries.errors.length > 0}
                · <span class="err">에러 {report.summaries.errors.length}</span>
              {/if}
            </li>
            <li>
              <span class="kind obs">Observations</span>
              신규 <strong class="new">{report.observations.created}</strong> ·
              skip {report.observations.skipped}
              {#if report.observations.errors.length > 0}
                · <span class="err">에러 {report.observations.errors.length}</span>
              {/if}
            </li>
          </ul>
          {#if report.summaries.errors.length + report.observations.errors.length > 0}
            <details>
              <summary>에러 상세</summary>
              <pre>{[...report.summaries.errors, ...report.observations.errors]
                .slice(0, 20)
                .join("\n")}{report.summaries.errors.length + report.observations.errors.length > 20
                ? "\n…"
                : ""}</pre>
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
            disabled={nothingToExport(preview)}
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

  /* kind 배지 — summary는 보라, obs는 청록 (RelatedMemoriesPanel/SearchModal 색 톤 통일) */
  .kind {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border-radius: 3px;
    margin-right: 8px;
    vertical-align: 1px;
  }

  .kind.summary {
    background: rgba(168, 119, 232, 0.18);
    color: #c4a3ff;
    border: 1px solid rgba(168, 119, 232, 0.35);
  }

  .kind.obs {
    background: rgba(73, 216, 196, 0.16);
    color: #7be4cf;
    border: 1px solid rgba(73, 216, 196, 0.35);
  }

  .toggles {
    display: flex;
    gap: 16px;
    margin: 10px 0 4px;
    font-size: 12px;
    color: #d0d0d0;
  }

  .toggles label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    user-select: none;
  }

  .toggles input[type="checkbox"] {
    accent-color: #6dd6ff;
    cursor: pointer;
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
