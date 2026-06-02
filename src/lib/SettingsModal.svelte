<script lang="ts">
  import {
    settingsOpen,
    closeSettings,
    claudeMemEnabled,
    applyClaudeMemToggle,
    linkRewriteBackupKeep,
    LINK_REWRITE_BACKUP_KEEP_MIN,
    LINK_REWRITE_BACKUP_KEEP_MAX,
    applyBackupKeep,
    clampBackupKeep,
  } from "$lib/stores/settings";
  import { themeMode, setTheme, type ThemeMode } from "$lib/stores/theme";

  const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
    { value: "system", label: "시스템" },
    { value: "light", label: "라이트" },
    { value: "dark", label: "다크" },
  ];

  // 확인 다이얼로그 분기: null | "enable" | "disable"
  let confirmMode = $state<null | "enable" | "disable">(null);
  let busy = $state(false);

  // 백업 max_keep — 입력 중에는 local state, blur/Enter 시 적용
  let backupKeepInput = $state<number>($linkRewriteBackupKeep);
  let backupKeepSaving = $state(false);
  let backupKeepHint = $state<string>("");

  // store가 외부에서 갱신되면 (예: 다른 모달, restoreSettings) input도 동기화
  $effect(() => {
    backupKeepInput = $linkRewriteBackupKeep;
  });

  async function commitBackupKeep() {
    if (backupKeepSaving) return;
    const raw = Number(backupKeepInput);
    const clamped = clampBackupKeep(raw);
    if (clamped !== raw) {
      backupKeepInput = clamped;
      backupKeepHint = `${LINK_REWRITE_BACKUP_KEEP_MIN}–${LINK_REWRITE_BACKUP_KEEP_MAX} 범위로 조정됨`;
    } else {
      backupKeepHint = "";
    }
    if (clamped === $linkRewriteBackupKeep) return; // 변경 없음 — 저장 skip
    backupKeepSaving = true;
    try {
      await applyBackupKeep(clamped);
      backupKeepHint = `저장됨 (max_keep=${clamped})`;
      setTimeout(() => {
        if (backupKeepHint.startsWith("저장됨")) backupKeepHint = "";
      }, 2000);
    } catch (e) {
      console.error("[Settings] backup_keep apply failed", e);
      backupKeepHint = "저장 실패 — 콘솔 확인";
    } finally {
      backupKeepSaving = false;
    }
  }

  function onBackupKeepKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  }

  function onToggleClaudeMem(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    // 사용자 의도를 confirmMode에 담고, 실제 store 변경은 확인 후
    confirmMode = checked ? "enable" : "disable";
    // 체크박스 자체는 원복 (모달 닫으면 원래 상태로)
    (e.target as HTMLInputElement).checked = $claudeMemEnabled;
  }

  async function applyChange() {
    if (busy || !confirmMode) return;
    busy = true;
    try {
      const nextEnabled = confirmMode === "enable";
      // 백엔드 동적 적용 — WAL watch / cleanup / 인덱스 빌드를 즉시 처리.
      // 재시작 불필요, 로그 연속 유지.
      await applyClaudeMemToggle(nextEnabled);
      busy = false;
      confirmMode = null;
      closeSettings();
    } catch (err) {
      console.error("[Settings] apply failed", err);
      busy = false;
      confirmMode = null;
    }
  }

  function cancelConfirm() {
    if (busy) return;
    confirmMode = null;
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget && !busy) closeSettings();
  }

  function onKeydown(e: KeyboardEvent) {
    if (busy) return;
    if (e.key === "Escape") {
      if (confirmMode) confirmMode = null;
      else closeSettings();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if $settingsOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="settings-backdrop" onclick={onBackdropClick}>
    <div class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header class="settings-head">
        <h2 id="settings-title">설정</h2>
        <button class="close-btn" aria-label="닫기" onclick={closeSettings}>×</button>
      </header>

      <div class="settings-body">
        <section class="setting-row">
          <div class="setting-label number">
            <span class="label-text">
              <span class="label-title">테마</span>
              <span class="label-desc">
                앱 색상 테마. "시스템"은 macOS 라이트/다크 설정을 따릅니다.
              </span>
            </span>
          </div>
          <div class="setting-control">
            <div class="segmented" role="group" aria-label="테마 선택">
              {#each THEME_OPTIONS as opt (opt.value)}
                <button
                  type="button"
                  class="segment"
                  class:active={$themeMode === opt.value}
                  aria-pressed={$themeMode === opt.value}
                  onclick={() => setTheme(opt.value)}
                >
                  {opt.label}
                </button>
              {/each}
            </div>
          </div>
        </section>

        <section class="setting-row">
          <label class="setting-label">
            <input
              type="checkbox"
              checked={$claudeMemEnabled}
              onchange={onToggleClaudeMem}
              disabled={busy}
            />
            <span class="label-text">
              <span class="label-title">claude-mem 통합</span>
              <span class="label-desc">
                AI 세션 메모리를 vault에 export하고 통합 검색·그래프에 표시합니다.
                claude-mem을 사용하지 않는 팀원은 비활성 상태로 두세요.
              </span>
            </span>
          </label>
          <div class="setting-status" class:on={$claudeMemEnabled}>
            {$claudeMemEnabled ? "ON" : "OFF"}
          </div>
        </section>

        <section class="setting-row">
          <div class="setting-label number">
            <span class="label-text">
              <span class="label-title">링크 갱신 백업 보존 개수</span>
              <span class="label-desc">
                노트 이름을 바꿀 때 영향 노트의 스냅샷이 vault 안
                <code>.lapis/link-rewrite-backup/</code>에 저장됩니다. 이 개수를 초과하면
                오래된 것부터 자동 삭제합니다. (범위 {LINK_REWRITE_BACKUP_KEEP_MIN}–{LINK_REWRITE_BACKUP_KEEP_MAX})
              </span>
              {#if backupKeepHint}
                <span class="label-hint">{backupKeepHint}</span>
              {/if}
            </span>
          </div>
          <div class="setting-control">
            <input
              type="number"
              class="number-input"
              min={LINK_REWRITE_BACKUP_KEEP_MIN}
              max={LINK_REWRITE_BACKUP_KEEP_MAX}
              step="1"
              bind:value={backupKeepInput}
              onblur={commitBackupKeep}
              onkeydown={onBackupKeepKeydown}
              disabled={backupKeepSaving || busy}
              aria-label="링크 갱신 백업 보존 개수"
            />
          </div>
        </section>
      </div>

      <footer class="settings-foot">
        <button class="btn btn--ghost" onclick={closeSettings} disabled={busy}>닫기</button>
      </footer>
    </div>
  </div>

  {#if confirmMode}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="confirm-backdrop" onclick={(e) => e.target === e.currentTarget && cancelConfirm()}>
      <div class="confirm-modal" role="dialog" aria-modal="true">
        <header class="confirm-head">
          {#if confirmMode === "enable"}
            <span class="icon">✓</span>
            <span>claude-mem 통합을 켜시겠어요?</span>
          {:else}
            <span class="icon warn">⚠</span>
            <span>claude-mem 통합을 끄시겠어요?</span>
          {/if}
        </header>
        <div class="confirm-body">
          {#if confirmMode === "enable"}
            <p>적용 후 다음 기능이 활성화됩니다:</p>
            <ul>
              <li>사이드바 mirror 상태 점 (Memory: Sync 진입)</li>
              <li>Cmd+Shift+M 메모리 검색</li>
              <li>그래프 메모리 노드 토글</li>
              <li>현재 노트와 연관된 메모리 패널</li>
            </ul>
            <p class="hint">claude-mem이 설치되어 있어야 실제 데이터가 채워집니다. (<code>~/.claude-mem/claude-mem.db</code>)</p>
          {:else}
            <p>적용 즉시 다음 로컬 데이터가 <strong>삭제</strong>됩니다:</p>
            <ul>
              <li>mirror DB (<code>lapis-mem.db</code>)</li>
              <li>검색 인덱스 — 다음에 다시 켤 때 vault만으로 재구축</li>
            </ul>
            <p>보존되는 항목:</p>
            <ul class="preserve">
              <li>vault 안 <code>_memories/</code> 폴더의 모든 .md 노트</li>
              <li>claude-mem 원본 (<code>~/.claude-mem/claude-mem.db</code>)</li>
            </ul>
          {/if}
          <p class="hint">변경은 즉시 적용됩니다 (재시작 불필요).</p>
        </div>
        <footer class="confirm-foot">
          <button class="btn btn--ghost" onclick={cancelConfirm} disabled={busy}>취소</button>
          <button class="btn btn--primary" onclick={applyChange} disabled={busy}>
            {busy ? "적용 중…" : "지금 적용"}
          </button>
        </footer>
      </div>
    </div>
  {/if}
{/if}

<style>
  .settings-backdrop,
  .confirm-backdrop {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 900;
    padding: var(--sp-10);
  }
  .confirm-backdrop {
    z-index: 950;
  }

  .settings-modal,
  .confirm-modal {
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-overlay);
    color: var(--text-primary);
    width: 100%;
    max-width: var(--modal-w-lg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .confirm-modal {
    max-width: var(--modal-w-md);
  }

  .settings-head,
  .confirm-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-default);
    background: var(--surface-overlay);
  }
  .settings-head h2 {
    margin: 0;
    font-size: var(--fs-md);
    font-weight: 600;
    flex: 1;
  }
  .confirm-head {
    font-size: var(--fs-base);
    font-weight: 600;
  }
  .icon {
    color: var(--accent);
    font-size: var(--fs-lg);
  }
  .icon.warn {
    color: var(--warning);
  }

  .close-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--fs-xl);
    line-height: 1;
    padding: var(--sp-1) var(--sp-3);
  }
  .close-btn:hover {
    color: var(--text-primary);
  }

  .settings-body {
    padding: var(--sp-6) 18px;
    max-height: 60vh;
    overflow-y: auto;
  }

  .setting-row {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-5);
    padding: var(--sp-5);
    background: var(--surface-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-lg);
  }

  .setting-label {
    flex: 1;
    display: flex;
    gap: 10px;
    cursor: pointer;
    align-items: flex-start;
  }
  .setting-label input[type="checkbox"] {
    margin-top: 3px;
    cursor: pointer;
  }
  .label-text {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }
  .label-title {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-primary);
  }
  .label-desc {
    font-size: 11.5px;
    color: var(--text-muted);
    line-height: 1.5;
  }
  .setting-status {
    font-size: 10px;
    font-weight: 700;
    padding: 3px var(--sp-4);
    border-radius: var(--r-lg);
    background: var(--surface-overlay);
    color: var(--text-muted);
    align-self: flex-start;
    letter-spacing: 0.05em;
  }
  .setting-status.on {
    background: var(--success-bg-subtle);
    color: var(--success);
  }

  .setting-label.number {
    flex: 1;
    display: flex;
    gap: 10px;
    align-items: flex-start;
    cursor: default;
  }
  .setting-control {
    align-self: flex-start;
  }
  .number-input {
    width: 64px;
    padding: var(--sp-2) var(--sp-4);
    background: var(--surface-sunken);
    border: 1px solid var(--border-strong);
    color: var(--text-primary);
    border-radius: var(--r-md);
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    text-align: right;
  }
  .number-input:focus {
    border-color: var(--accent);
  }
  .number-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .label-hint {
    margin-top: var(--sp-3);
    font-size: var(--fs-xs);
    color: var(--accent);
  }
  .label-text code {
    background: var(--surface-sunken);
    padding: 1px 5px;
    border-radius: var(--r-sm);
    font-size: var(--fs-xs);
    color: var(--warning);
  }

  .settings-foot,
  .confirm-foot {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-4);
    padding: var(--sp-5) 18px;
    border-top: 1px solid var(--border-default);
    background: var(--surface-base);
  }

  .confirm-body {
    padding: 14px 18px;
    font-size: 12.5px;
    color: var(--text-secondary);
    line-height: 1.6;
  }
  .confirm-body p {
    margin: 0 0 10px 0;
  }
  .confirm-body ul {
    margin: 0 0 var(--sp-5) 0;
    padding-left: 22px;
  }
  .confirm-body ul.preserve li {
    color: var(--accent-hover);
  }
  .confirm-body code {
    background: var(--surface-sunken);
    padding: 1px 5px;
    border-radius: var(--r-sm);
    font-size: var(--fs-xs);
    color: var(--warning);
  }
  .confirm-body .hint {
    color: var(--text-muted);
    font-size: 11.5px;
    margin-top: var(--sp-4);
  }

  /* 액션 버튼은 app.css의 .btn 프리미티브 사용 (.btn / .btn--ghost / .btn--primary) */

  /* 테마 세그먼트 컨트롤 (디자인 토큰 사용) */
  .segmented {
    display: inline-flex;
    gap: var(--sp-1);
    padding: var(--sp-1);
    background: var(--surface-sunken);
    border: 1px solid var(--border-default);
    border-radius: var(--r-md);
  }
  .segment {
    appearance: none;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-family: inherit;
    font-size: var(--fs-sm);
    padding: var(--sp-2) var(--sp-5);
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: background var(--dur-fast), color var(--dur-fast);
  }
  .segment:hover {
    color: var(--text-primary);
  }
  .segment.active {
    background: var(--accent-bg-subtle);
    color: var(--accent);
  }
</style>
