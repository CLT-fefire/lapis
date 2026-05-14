<script lang="ts">
  import {
    settingsOpen,
    closeSettings,
    claudeMemEnabled,
    setClaudeMemEnabled,
  } from "$lib/stores/settings";
  import { appRestart } from "$lib/tauri/settings";

  // 확인 다이얼로그 분기: null | "enable" | "disable"
  let confirmMode = $state<null | "enable" | "disable">(null);
  let busy = $state(false);

  function onToggleClaudeMem(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    // 사용자 의도를 confirmMode에 담고, 실제 store 변경은 확인 후
    confirmMode = checked ? "enable" : "disable";
    // 체크박스 자체는 원복 (모달 닫으면 원래 상태로)
    (e.target as HTMLInputElement).checked = $claudeMemEnabled;
  }

  async function applyAndRestart() {
    if (busy || !confirmMode) return;
    busy = true;
    try {
      const nextEnabled = confirmMode === "enable";
      const pendingCleanup = confirmMode === "disable"; // OFF 전환만 cleanup 필요
      await setClaudeMemEnabled(nextEnabled, pendingCleanup);
      await appRestart();
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
      </div>

      <footer class="settings-foot">
        <button class="btn ghost" onclick={closeSettings} disabled={busy}>닫기</button>
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
            <p>재시작 후 다음 기능이 활성화됩니다:</p>
            <ul>
              <li>사이드바 mirror 상태 점 (Memory: Sync 진입)</li>
              <li>Cmd+Shift+M 메모리 검색</li>
              <li>그래프 메모리 노드 토글</li>
              <li>현재 노트와 연관된 메모리 패널</li>
            </ul>
            <p class="hint">claude-mem이 설치되어 있어야 실제 데이터가 채워집니다. (<code>~/.claude-mem/claude-mem.db</code>)</p>
          {:else}
            <p>재시작 후 다음 로컬 데이터가 <strong>삭제</strong>됩니다:</p>
            <ul>
              <li>mirror DB (<code>lapis-mem.db</code>)</li>
              <li>검색 인덱스 — 다음 시작 시 vault만으로 재구축</li>
            </ul>
            <p>보존되는 항목:</p>
            <ul class="preserve">
              <li>vault 안 <code>_memories/</code> 폴더의 모든 .md 노트</li>
              <li>claude-mem 원본 (<code>~/.claude-mem/claude-mem.db</code>)</li>
            </ul>
          {/if}
          <p class="hint">변경은 재시작 후 적용됩니다.</p>
        </div>
        <footer class="confirm-foot">
          <button class="btn ghost" onclick={cancelConfirm} disabled={busy}>취소</button>
          <button class="btn primary" onclick={applyAndRestart} disabled={busy}>
            {busy ? "재시작 중…" : "지금 재시작"}
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
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 900;
    padding: 32px;
  }
  .confirm-backdrop {
    z-index: 950;
  }

  .settings-modal,
  .confirm-modal {
    background: #232323;
    border: 1px solid #3a3a3a;
    border-radius: 10px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    color: #e8e8e8;
    width: 100%;
    max-width: 540px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .confirm-modal {
    max-width: 460px;
  }

  .settings-head,
  .confirm-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px;
    border-bottom: 1px solid #333;
    background: #2a2a2a;
  }
  .settings-head h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    flex: 1;
  }
  .confirm-head {
    font-size: 13px;
    font-weight: 600;
  }
  .icon {
    color: #6dd6ff;
    font-size: 16px;
  }
  .icon.warn {
    color: #f7c947;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: #999;
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
    padding: 2px 6px;
  }
  .close-btn:hover {
    color: #fff;
  }

  .settings-body {
    padding: 16px 18px;
    max-height: 60vh;
    overflow-y: auto;
  }

  .setting-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px;
    background: #1e1e1e;
    border: 1px solid #2f2f2f;
    border-radius: 8px;
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
    gap: 4px;
  }
  .label-title {
    font-size: 13px;
    font-weight: 600;
    color: #e8e8e8;
  }
  .label-desc {
    font-size: 11.5px;
    color: #999;
    line-height: 1.5;
  }
  .setting-status {
    font-size: 10px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 10px;
    background: #2a2a2a;
    color: #888;
    align-self: flex-start;
    letter-spacing: 0.05em;
  }
  .setting-status.on {
    background: #2d4a36;
    color: #5ad469;
  }

  .settings-foot,
  .confirm-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid #333;
    background: #1e1e1e;
  }

  .confirm-body {
    padding: 14px 18px;
    font-size: 12.5px;
    color: #ccc;
    line-height: 1.6;
  }
  .confirm-body p {
    margin: 0 0 10px 0;
  }
  .confirm-body ul {
    margin: 0 0 12px 0;
    padding-left: 22px;
  }
  .confirm-body ul.preserve li {
    color: #9adff7;
  }
  .confirm-body code {
    background: #1a1a1a;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 11px;
    color: #f7c947;
  }
  .confirm-body .hint {
    color: #888;
    font-size: 11.5px;
    margin-top: 8px;
  }

  .btn {
    background: #2a2a2a;
    border: 1px solid #444;
    color: #ddd;
    border-radius: 5px;
    padding: 6px 14px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }
  .btn:hover:not(:disabled) {
    border-color: #6dd6ff;
    background: #333;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn.ghost {
    background: transparent;
  }
  .btn.primary {
    background: #2d4a5a;
    border-color: #6dd6ff;
    color: #6dd6ff;
  }
  .btn.primary:hover:not(:disabled) {
    background: #3a5d70;
  }
</style>
