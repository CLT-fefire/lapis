<script lang="ts">
  import ModalShell from "$lib/ModalShell.svelte";
  import {
    settingsOpen,
    closeSettings,
    linkRewriteBackupKeep,
    LINK_REWRITE_BACKUP_KEEP_MIN,
    LINK_REWRITE_BACKUP_KEEP_MAX,
    applyBackupKeep,
    clampBackupKeep,
    mcpEnabled,
    applyMcpEnabled,
  } from "$lib/stores/settings";
  import { themeMode, setTheme, type ThemeMode } from "$lib/stores/theme";
  import { density, setDensity, type Density } from "$lib/stores/density";
  import {
    readingMeasureLimited,
    setReadingMeasureLimited,
  } from "$lib/stores/reading";
  import { vaultPath, forceReindex } from "$lib/stores/vault";
  import { localeMode, setLocaleMode, type LocaleMode } from "$lib/stores/locale";
  import { m } from "$lib/paraglide/messages.js";
  import { gitRepo, gitBusy, startVersioning, refreshGitStatus } from "$lib/stores/git";
  import { get } from "svelte/store";

  // ⚠️ `{#key $activeLocale}`(+layout)이 로케일 변경 시 컴포넌트를 재생성하므로
  // 이 const들도 다시 평가된다 — 그래서 최상위 const로 둬도 로케일을 따라온다.
  const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
    { value: "system", label: m.settings_theme_system() },
    { value: "light", label: m.settings_theme_light() },
    { value: "dark", label: m.settings_theme_dark() },
  ];

  const DENSITY_OPTIONS: { value: Density; label: string }[] = [
    { value: "default", label: m.settings_density_default() },
    { value: "compact", label: m.settings_density_compact() },
  ];

  const MEASURE_OPTIONS: { value: boolean; label: string }[] = [
    { value: true, label: m.settings_measure_limited() },
    { value: false, label: m.settings_measure_full() },
  ];

  // 언어명은 **그 언어로** 표기한다(시스템만 번역 대상) — 어느 로케일에서 보든
  // 자기 언어를 찾을 수 있어야 하기 때문. OS·브라우저 설정 UI의 관행이다.
  const LOCALE_OPTIONS: { value: LocaleMode; label: string }[] = [
    { value: "system", label: m.settings_language_system() },
    { value: "ko", label: "한국어" },
    { value: "en", label: "English" },
  ];

  const MCP_OPTIONS: { value: boolean; label: string }[] = [
    { value: true, label: m.settings_mcp_allow() },
    { value: false, label: m.settings_mcp_block() },
  ];

  let mcpHint = $state<string>("");

  async function setMcp(v: boolean) {
    if ($mcpEnabled === v) return;
    try {
      await applyMcpEnabled(v);
      mcpHint = "";
    } catch (e) {
      mcpHint = m.settings_mcp_save_failed({ error: (e as Error)?.message ?? String(e) });
    }
  }

  // 백업 max_keep — 입력 중에는 local state, blur/Enter 시 적용
  let backupKeepInput = $state<number>($linkRewriteBackupKeep);
  let backupKeepSaving = $state(false);
  let backupKeepHint = $state<string>("");
  /** "저장됨" 힌트 자동 소거용 — 표시 문자열을 비교하지 않기 위한 세대 카운터. */
  let backupKeepHintToken = 0;

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
      backupKeepHint = m.settings_backup_clamped({
        min: LINK_REWRITE_BACKUP_KEEP_MIN,
        max: LINK_REWRITE_BACKUP_KEEP_MAX,
      });
    } else {
      backupKeepHint = "";
    }
    if (clamped === $linkRewriteBackupKeep) return; // 변경 없음 — 저장 skip
    backupKeepSaving = true;
    try {
      await applyBackupKeep(clamped);
      backupKeepHint = m.settings_backup_saved({ count: clamped });
      // ⚠️ 예전엔 `backupKeepHint.startsWith("저장됨")`으로 지웠는데, **표시 문자열을
      // 비교하는 건 번역되면 깨진다**(영어에선 항상 false → 힌트가 안 사라진다).
      // 토큰으로 "지금 지워도 되는 힌트인지"를 판정한다.
      const token = ++backupKeepHintToken;
      setTimeout(() => {
        if (backupKeepHintToken === token) backupKeepHint = "";
      }, 2000);
    } catch (e) {
      console.error("[Settings] backup_keep apply failed", e);
      backupKeepHint = m.settings_backup_save_failed();
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

  // === Git 버전관리 (ADR-004) ===
  // 설정 열릴 때 현재 vault의 repo 여부를 갱신(배너를 "나중에"로 닫았어도 여기서 항상 시작 가능).
  let gitHint = $state("");
  $effect(() => {
    if ($settingsOpen) {
      gitHint = "";
      void refreshGitStatus(get(vaultPath));
    }
  });

  async function onStartVersioning() {
    const vault = get(vaultPath);
    if (!vault || $gitBusy) return;
    await startVersioning(vault);
    gitHint = $gitRepo ? m.settings_git_started() : m.settings_git_start_failed();
  }

  // === 인덱스 강제 재구축 ===
  // 보통은 자동 반영(watcher 증분 + launch fingerprint)되지만, 외부 대량 변경이 검색에
  // 안 잡힐 때를 위한 수동 escape hatch. 캐시 무시·워커 초기화 후 전체 재빌드.
  // 설정을 닫고 트리거 — 진행/완료는 사이드바 blocking 오버레이(+progress)가 표시한다
  // (재구축 중 풀텍스트가 torn이라 사이드바·팔레트를 막는다). 읽기 패널은 계속 사용 가능.
  function onRebuildIndex() {
    if (!get(vaultPath)) return;
    closeSettings();
    void forceReindex().catch((e) => console.error("[Settings] rebuild index failed", e));
  }
</script>

{#if $settingsOpen}
  <ModalShell onClose={closeSettings} label={m.settings_title()}>
    <div class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header class="settings-head">
        <h2 id="settings-title">{m.settings_title()}</h2>
        <button class="btn btn--icon btn--sm btn--plain" aria-label={m.settings_close()} onclick={closeSettings}>×</button>
      </header>

      <div class="settings-body">
        <section class="setting-row">
          <div class="setting-label number">
            <span class="label-text">
              <span class="label-title">{m.settings_language_title()}</span>
              <span class="label-desc">{m.settings_language_desc()}</span>
            </span>
          </div>
          <div class="setting-control">
            <div class="segmented" role="group" aria-label={m.settings_language_title()}>
              {#each LOCALE_OPTIONS as opt (opt.value)}
                <button
                  type="button"
                  class="segment"
                  class:active={$localeMode === opt.value}
                  aria-pressed={$localeMode === opt.value}
                  onclick={() => setLocaleMode(opt.value)}
                >
                  {opt.label}
                </button>
              {/each}
            </div>
          </div>
        </section>

        <section class="setting-row">
          <div class="setting-label number">
            <span class="label-text">
              <span class="label-title">{m.settings_theme_title()}</span>
              <span class="label-desc">{m.settings_theme_desc()}</span>
            </span>
          </div>
          <div class="setting-control">
            <div class="segmented" role="group" aria-label={m.settings_theme_aria()}>
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
          <div class="setting-label number">
            <span class="label-text">
              <span class="label-title">{m.settings_density_title()}</span>
              <span class="label-desc">{m.settings_density_desc()}</span>
            </span>
          </div>
          <div class="setting-control">
            <div class="segmented" role="group" aria-label={m.settings_density_aria()}>
              {#each DENSITY_OPTIONS as opt (opt.value)}
                <button
                  type="button"
                  class="segment"
                  class:active={$density === opt.value}
                  aria-pressed={$density === opt.value}
                  onclick={() => setDensity(opt.value)}
                >
                  {opt.label}
                </button>
              {/each}
            </div>
          </div>
        </section>

        <section class="setting-row">
          <div class="setting-label number">
            <span class="label-text">
              <span class="label-title">{m.settings_measure_title()}</span>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <span class="label-desc">{@html m.settings_measure_desc()}</span>
            </span>
          </div>
          <div class="setting-control">
            <div class="segmented" role="group" aria-label={m.settings_measure_aria()}>
              {#each MEASURE_OPTIONS as opt (opt.value)}
                <button
                  type="button"
                  class="segment"
                  class:active={$readingMeasureLimited === opt.value}
                  aria-pressed={$readingMeasureLimited === opt.value}
                  onclick={() => setReadingMeasureLimited(opt.value)}
                >
                  {opt.label}
                </button>
              {/each}
            </div>
          </div>
        </section>

        <section class="setting-row">
          <div class="setting-label number">
            <span class="label-text">
              <span class="label-title">{m.settings_backup_title()}</span>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <span class="label-desc">
                {@html m.settings_backup_desc({
                  min: LINK_REWRITE_BACKUP_KEEP_MIN,
                  max: LINK_REWRITE_BACKUP_KEEP_MAX,
                })}
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
              disabled={backupKeepSaving}
              aria-label={m.settings_backup_aria()}
            />
          </div>
        </section>

        <section class="setting-row">
          <div class="setting-label number">
            <span class="label-text">
              <span class="label-title">{m.settings_mcp_title()}</span>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <span class="label-desc">{@html m.settings_mcp_desc()}</span>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <span class="label-hint">{@html m.settings_mcp_warn()}</span>
              {#if mcpHint}
                <span class="label-hint">{mcpHint}</span>
              {/if}
            </span>
          </div>
          <div class="setting-control">
            <div class="segmented" role="group" aria-label={m.settings_mcp_aria()}>
              {#each MCP_OPTIONS as opt (opt.value)}
                <button
                  type="button"
                  class="segment"
                  class:active={$mcpEnabled === opt.value}
                  aria-pressed={$mcpEnabled === opt.value}
                  onclick={() => setMcp(opt.value)}
                >
                  {opt.label}
                </button>
              {/each}
            </div>
          </div>
        </section>

        <section class="setting-row">
          <div class="setting-label number">
            <span class="label-text">
              <span class="label-title">{m.settings_git_title()}</span>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <span class="label-desc">{@html m.settings_git_desc()}</span>
              {#if gitHint}
                <span class="label-hint">{gitHint}</span>
              {/if}
            </span>
          </div>
          <div class="setting-control">
            {#if !$vaultPath}
              <span class="setting-status">{m.settings_git_no_vault()}</span>
            {:else if $gitRepo}
              <span class="setting-status on">{m.settings_git_active()}</span>
            {:else}
              <button
                class="btn btn--primary btn--sm"
                disabled={$gitBusy}
                onclick={onStartVersioning}
              >
                {$gitBusy ? m.settings_git_starting() : m.settings_git_start()}
              </button>
            {/if}
          </div>
        </section>

        <section class="setting-row">
          <div class="setting-label number">
            <span class="label-text">
              <span class="label-title">{m.settings_reindex_title()}</span>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <span class="label-desc">{@html m.settings_reindex_desc()}</span>
            </span>
          </div>
          <div class="setting-control">
            {#if !$vaultPath}
              <span class="setting-status">{m.settings_git_no_vault()}</span>
            {:else}
              <button class="btn btn--sm" onclick={onRebuildIndex}>{m.settings_reindex_button()}</button>
            {/if}
          </div>
        </section>
      </div>

      <footer class="settings-foot">
        <button class="btn btn--ghost" onclick={closeSettings}>{m.settings_close()}</button>
      </footer>
    </div>
  </ModalShell>
{/if}

<style>
  .settings-modal {
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

  .settings-head {
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
  /* ⚠️ `:global()`이 필요하다 — 설명 문구는 번역 문자열에 인라인 마크업(`<code>`·
     `<strong>`)이 들어 있어 `{@html}`로 그린다. **Svelte scoped CSS는 `{@html}`이
     주입한 요소에 안 붙는다**(스코프 클래스가 안 찍힌다) → 그냥 `code`로 두면
     "Unused CSS selector" 경고와 함께 스타일이 죽는다. 실제로 그렇게 한 번 깨졌다. */
  .label-text :global(code) {
    background: var(--surface-sunken);
    padding: 1px 5px;
    border-radius: var(--r-sm);
    font-size: var(--fs-xs);
    color: var(--warning);
  }

  .settings-foot {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-4);
    padding: var(--sp-5) 18px;
    border-top: 1px solid var(--border-default);
    background: var(--surface-base);
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
