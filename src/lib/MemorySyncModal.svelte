<script lang="ts">
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { memorySyncOpen, closeMemorySync } from "$lib/stores/memorySync";
  import { vaultPath, reloadNotes } from "$lib/stores/vault";
  import { loadVaultConfig } from "$lib/vaultConfig";
  import {
    memoryPreviewExport,
    memoryExportToVault,
    MEMORY_EXPORT_PROGRESS_EVENT,
    type PreviewReport,
    type ExportReport,
    type ExportProgressPayload,
  } from "$lib/tauri/memory";
  import {
    mirrorSyncNow,
    mirrorSyncStatus,
    type SyncReport,
    type SyncStatus,
  } from "$lib/tauri/mirror";

  type Stage =
    | "preview-loading"
    | "confirm"
    | "exporting"
    | "indexing"
    | "done"
    | "error";

  let stage: Stage = $state("preview-loading");
  let preview: PreviewReport | null = $state(null);
  let report: ExportReport | null = $state(null);
  let projectsFilter: string[] = $state([]);
  let errorMessage = $state("");

  // 체크박스 — vault config의 default를 초기값으로 두고 사용자가 모달 안에서 일회성 override 가능.
  let includeSummaries = $state(true);
  let includeObservations = $state(false);

  // exporting stage progress — Rust 측 emit으로 갱신.
  let summaryProgress: ExportProgressPayload | null = $state(null);
  let obsProgress: ExportProgressPayload | null = $state(null);
  let unlistenProgress: UnlistenFn | null = null;
  let exportStartedAt = 0; // 경과 시간 표시용 (ms epoch)
  let elapsedSec = $state(0);
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;

  // Search 인덱스 reindex progress — Phase Search #7.
  // mirror sync 후 백그라운드로 tantivy reindex 진행 시 event listen.
  // 첫 빌드는 ~수십 초 가능 (11000+ row), 이후 incremental은 ~수 초.
  let reindexProgress: { current: number; total: number; added: number } | null = $state(null);
  let reindexUnlisten: UnlistenFn | null = null;

  // Lapis mirror DB sync — .md export와 독립 영역. PR1 단위 #6.
  let mirrorStatus: SyncStatus | null = $state(null);
  let mirrorReport: SyncReport | null = $state(null);
  let mirrorBusy = $state(false);
  let mirrorError = $state("");

  // 모달 열릴 때마다 preview + mirror 상태 동시 로드 + reindex progress listen
  $effect(() => {
    if (!$memorySyncOpen) return;
    void runPreview();
    void refreshMirrorStatus();

    // search reindex progress — 모달 열린 동안 listen. 완료 시 null로.
    void listen<{ current: number; total: number; added: number }>(
      "search-reindex-progress",
      (event) => {
        reindexProgress = event.payload;
        // current == total → 완료. 1초 후 자동 hide.
        if (event.payload.current >= event.payload.total) {
          setTimeout(() => {
            reindexProgress = null;
          }, 1500);
        }
      },
    ).then((u) => (reindexUnlisten = u));

    return () => {
      reindexUnlisten?.();
      reindexUnlisten = null;
    };
  });

  async function refreshMirrorStatus() {
    try {
      mirrorStatus = await mirrorSyncStatus();
    } catch {
      mirrorStatus = null;
    }
  }

  async function runMirrorSync(full: boolean) {
    mirrorBusy = true;
    mirrorError = "";
    mirrorReport = null;
    try {
      // vault path 전달 → mirror 삭제 시 .md 자동 정리 + orphans.json 박제 (PR2 #12)
      mirrorReport = await mirrorSyncNow(full, $vaultPath || null);
      await refreshMirrorStatus();
      // mirror에 새 row가 들어왔으면 export preview 카운트도 stale → 자동 갱신.
      // (모달 confirm 단계에서만 의미 — 다른 단계면 refreshPreview 자체가 noop)
      await refreshPreview();
    } catch (e) {
      mirrorError = `mirror sync 실패: ${e}`;
    } finally {
      mirrorBusy = false;
    }
  }

  /** epoch(s) → "YYYY-MM-DD HH:mm" 로컬 표시. 0이면 "—". */
  function formatEpoch(epoch: number): string {
    if (!epoch) return "—";
    const d = new Date(epoch * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

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
    summaryProgress = null;
    obsProgress = null;
    exportStartedAt = Date.now();
    elapsedSec = 0;

    // 경과 시간 1초마다 갱신
    elapsedTimer = setInterval(() => {
      elapsedSec = Math.floor((Date.now() - exportStartedAt) / 1000);
    }, 1000);

    // Rust 측 progress emit 수신 등록 (await 후에 export 호출해야 첫 emit 놓치지 않음)
    try {
      unlistenProgress = await listen<ExportProgressPayload>(
        MEMORY_EXPORT_PROGRESS_EVENT,
        (e) => {
          if (e.payload.phase === "summary") summaryProgress = e.payload;
          else if (e.payload.phase === "observation") obsProgress = e.payload;
        },
      );
    } catch (e) {
      // listen 등록 실패해도 export 자체는 진행 (progress UI만 비활성)
      console.warn("progress listen 등록 실패:", e);
    }

    try {
      report = await memoryExportToVault(
        vault,
        projectsFilter,
        includeSummaries,
        includeObservations,
      );
      // progress emit 정리는 이미 끝났지만 listen은 indexing 동안 유지 가능 — 안전하게 일찍 해제
      cleanupProgress();
      // 인덱스 갱신 단계로 전환 — file watcher의 scheduleFullReload(500ms 디바운스)와
      // 중복되지 않도록 reloadNotes 내부 reloadInFlight guard가 처리.
      // 이 phase가 끝나야 사이드바 트리/검색 인덱스가 새 노트 반영 — 사용자에게 명시적으로 보여줌.
      stage = "indexing";
      try {
        await reloadNotes();
      } catch (e) {
        console.warn("[memory-sync] reloadNotes after export failed:", e);
      }
      stage = "done";
    } catch (e) {
      stage = "error";
      errorMessage = `export 실패: ${e}`;
      cleanupProgress();
    }
  }

  function cleanupProgress() {
    if (unlistenProgress) {
      unlistenProgress();
      unlistenProgress = null;
    }
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  }

  function close() {
    cleanupProgress();
    closeMemorySync();
    // 다음 열릴 때 초기 상태로 — $effect가 새로 preview 호출하니 stage 등은 자동 리셋되지만
    // 모달 닫힐 때 명시적으로 정리.
    stage = "preview-loading";
    preview = null;
    report = null;
    errorMessage = "";
    summaryProgress = null;
    obsProgress = null;
  }

  function onBackdrop(e: MouseEvent) {
    // exporting / indexing 동안엔 backdrop 클릭 닫기 차단 (진행 중)
    if (
      e.target === e.currentTarget &&
      stage !== "exporting" &&
      stage !== "indexing"
    ) {
      close();
    }
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
        {#if stage !== "exporting" && stage !== "indexing"}
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

          {#if mirrorStatus}
            <hr class="mirror-sep" />
            <div class="mirror">
              <div class="mirror-head">
                <span class="mirror-title">Lapis mirror</span>
                <span class="hint">
                  {mirrorStatus.memory_count.toLocaleString()} memories ·
                  최근 {formatEpoch(mirrorStatus.last_incremental_sync_at)}
                </span>
              </div>
              {#if mirrorReport}
                <p class="mirror-result">
                  ✓ {mirrorReport.full ? "풀" : "증분"} sync —
                  summaries {mirrorReport.summaries_upserted} ·
                  observations {mirrorReport.observations_upserted} ·
                  deleted {mirrorReport.deleted} · {mirrorReport.duration_ms}ms
                </p>
              {/if}
              {#if mirrorError}
                <p class="err">{mirrorError}</p>
              {/if}
              <div class="mirror-actions">
                <button class="btn small" disabled={mirrorBusy} onclick={() => runMirrorSync(false)}>
                  {mirrorBusy ? "동기화 중…" : "증분 sync"}
                </button>
                <button class="btn small" disabled={mirrorBusy} onclick={() => runMirrorSync(true)}>
                  {mirrorBusy ? "동기화 중…" : "풀 sync"}
                </button>
              </div>
              {#if reindexProgress}
                <div class="reindex-row">
                  <span class="hint">
                    검색 인덱스 빌드 중 · {reindexProgress.current.toLocaleString()} / {reindexProgress.total.toLocaleString()}
                    {#if reindexProgress.added > 0}
                      · +{reindexProgress.added.toLocaleString()}
                    {/if}
                  </span>
                  <div class="prog-bar">
                    <div
                      class="prog-fill"
                      style="width: {reindexProgress.total > 0
                        ? Math.min(100, (reindexProgress.current / reindexProgress.total) * 100)
                        : 0}%"
                    ></div>
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        {:else if stage === "exporting"}
          <p>Export 중… <span class="hint">({elapsedSec}s 경과)</span></p>
          {#if summaryProgress}
            <div class="prog-row">
              <div class="prog-head">
                <span class="kind summary">Session summaries</span>
                <span class="prog-text">
                  {summaryProgress.current} / {summaryProgress.total}
                  · 생성 {summaryProgress.created} · skip {summaryProgress.skipped}
                  {#if summaryProgress.errors > 0}
                    · <span class="err">에러 {summaryProgress.errors}</span>
                  {/if}
                </span>
              </div>
              <div class="prog-bar">
                <div
                  class="prog-fill summary"
                  style="width: {summaryProgress.total > 0
                    ? Math.min(100, (summaryProgress.current / summaryProgress.total) * 100)
                    : 0}%"
                ></div>
              </div>
            </div>
          {/if}
          {#if obsProgress}
            <div class="prog-row">
              <div class="prog-head">
                <span class="kind obs">Observations</span>
                <span class="prog-text">
                  {obsProgress.current} / {obsProgress.total}
                  · 생성 {obsProgress.created} · skip {obsProgress.skipped}
                  {#if obsProgress.errors > 0}
                    · <span class="err">에러 {obsProgress.errors}</span>
                  {/if}
                </span>
              </div>
              <div class="prog-bar">
                <div
                  class="prog-fill obs"
                  style="width: {obsProgress.total > 0
                    ? Math.min(100, (obsProgress.current / obsProgress.total) * 100)
                    : 0}%"
                ></div>
              </div>
            </div>
          {/if}
          {#if !summaryProgress && !obsProgress}
            <p class="hint">시작 중…</p>
          {/if}
        {:else if stage === "indexing"}
          <div class="indexing-row">
            <div class="spinner" aria-hidden="true"></div>
            <div class="indexing-text">
              <div class="primary">인덱스 갱신 중…</div>
              <div class="secondary">백링크 · 태그 · 풀텍스트 검색 재구성 (사이드바 트리/검색 반영)</div>
            </div>
          </div>
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
            title={nothingToExport(preview)
              ? "신규 export 대상이 없어도 export 함수를 다시 돌립니다 (모두 skip 처리)"
              : "신규 메모리를 vault에 export"}
          >
            {nothingToExport(preview) ? "다시 동기화 (변경 없음)" : "Sync 시작"}
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
    background: var(--backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
    padding: 32px;
  }

  .modal {
    width: min(520px, 92vw);
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    border-radius: var(--r-lg);
    color: var(--text-primary);
    box-shadow: var(--shadow-overlay);
    display: flex;
    flex-direction: column;
  }

  header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-default);
  }

  .title {
    font-weight: 600;
    color: var(--accent);
  }

  .close {
    margin-left: auto;
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: var(--fs-md);
    cursor: pointer;
    padding: 4px 8px;
  }

  .close:hover {
    color: var(--text-primary);
  }

  .body {
    padding: 16px;
    font-size: var(--fs-base);
    line-height: 1.6;
  }

  .body p {
    margin: 0 0 8px;
  }

  .body .hint {
    color: var(--text-muted);
    font-size: var(--fs-sm);
  }

  .body .info {
    color: var(--warning);
  }

  .body .err {
    color: var(--danger);
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
    color: var(--accent);
  }

  /* kind 배지 — summary는 보라, obs는 청록 (RelatedMemoriesPanel/SearchModal 색 톤 통일) */
  .kind {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border-radius: var(--r-xs);
    margin-right: 8px;
    vertical-align: 1px;
  }

  .kind.summary {
    background: var(--violet-bg-subtle);
    color: var(--violet);
    border: 1px solid var(--violet-border);
  }

  .kind.obs {
    background: var(--teal-bg-subtle);
    color: var(--teal);
    border: 1px solid var(--teal-border);
  }

  .toggles {
    display: flex;
    gap: 16px;
    margin: 10px 0 4px;
    font-size: var(--fs-sm);
    color: var(--text-secondary);
  }

  .toggles label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    user-select: none;
  }

  .toggles input[type="checkbox"] {
    accent-color: var(--accent);
    cursor: pointer;
  }

  /* exporting stage progress bar */
  .prog-row {
    margin: 12px 0;
  }

  .prog-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    font-size: var(--fs-sm);
  }

  .prog-text {
    color: var(--text-secondary);
    font-size: var(--fs-xs);
  }

  .prog-bar {
    width: 100%;
    height: 6px;
    background: var(--surface-overlay);
    border-radius: var(--r-xs);
    overflow: hidden;
  }

  .prog-fill {
    height: 100%;
    transition: width var(--dur-base) ease-out;
    border-radius: var(--r-xs);
  }

  .prog-fill.summary {
    background: linear-gradient(90deg, var(--violet), var(--violet));
  }

  .prog-fill.obs {
    background: linear-gradient(90deg, var(--teal), var(--teal));
  }

  /* indexing stage — 사이드바 dim overlay와 톤 통일 (spinner + 2줄 텍스트) */
  .indexing-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 4px;
  }

  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid var(--border-subtle);
    border-top-color: var(--accent);
    border-radius: var(--r-full);
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .indexing-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .indexing-text .primary {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  .indexing-text .secondary {
    font-size: var(--fs-xs);
    color: var(--text-muted);
  }

  details {
    margin-top: 10px;
    font-size: var(--fs-sm);
  }

  details summary {
    cursor: pointer;
    color: var(--text-secondary);
  }

  pre {
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md);
    padding: 8px;
    overflow: auto;
    max-height: 180px;
    color: var(--text-secondary);
    font-size: var(--fs-xs);
  }

  code {
    background: var(--surface-overlay);
    padding: 1px 5px;
    border-radius: var(--r-xs);
    font-size: var(--fs-xs);
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--border-default);
  }

  .btn {
    padding: 6px 14px;
    background: transparent;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    color: var(--text-primary);
    font-size: var(--fs-sm);
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    background: var(--surface-overlay);
    border-color: var(--border-strong);
  }

  .btn.primary {
    background: var(--accent-bg-subtle);
    border-color: var(--accent-border);
    color: var(--accent);
  }

  .btn.primary:hover:not(:disabled) {
    background: var(--accent-bg-subtle);
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn.small {
    padding: 4px 10px;
    font-size: 0.85em;
  }

  .mirror-sep {
    border: 0;
    border-top: 1px solid var(--border-default);
    margin: 14px 0 10px;
  }

  .mirror {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .mirror-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .mirror-title {
    font-weight: 600;
    color: var(--text-secondary);
  }

  .mirror-result {
    color: var(--accent-hover);
    font-size: 0.85em;
    margin: 2px 0 0;
  }

  .mirror-actions {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }

  .reindex-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px dashed var(--border-subtle);
  }

  .reindex-row .prog-bar {
    height: 4px;
    background: var(--surface-overlay);
    border-radius: var(--r-xs);
    overflow: hidden;
  }

  .reindex-row .prog-fill {
    height: 100%;
    background: var(--teal);
    transition: width var(--dur-slow) ease-out;
  }
</style>
