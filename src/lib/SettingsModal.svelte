<script lang="ts">
  import ModalShell from "$lib/ModalShell.svelte";
  import CustomCssEditor from "$lib/CustomCssEditor.svelte";
  import { getVersion } from "@tauri-apps/api/app";
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

  /**
   * 설정 카테고리. **순서가 화면 순서다.**
   *
   * ⚠️ 새 설정을 더할 때 어느 카테고리인지 정하지 않으면 어디에도 안 보인다 —
   * 예전 평평한 목록에서는 그냥 아래 붙이면 됐다. `settingsCategories.test.ts`가
   * 모든 섹션이 어떤 카테고리에는 속하는지 본다.
   */
  const CATEGORIES = [
    { id: "appearance", label: () => m.settings_cat_appearance() },
    { id: "language", label: () => m.settings_cat_language() },
    { id: "vault", label: () => m.settings_cat_vault() },
    { id: "advanced", label: () => m.settings_cat_advanced() },
  ] as const;

  type CatId = (typeof CATEGORIES)[number]["id"];
  let cat = $state<CatId>("appearance");
  const activeLabel = $derived(
    () => CATEGORIES.find((c) => c.id === cat)?.label() ?? m.settings_title(),
  );

  /** 버전 — 카테고리 목록 하단(디스코드가 버전을 두는 자리). */
  let appVersion = $state<string>("");
  $effect(() => {
    void getVersion()
      .then((v) => (appVersion = v))
      // 버전을 못 읽어도 설정은 열려야 한다. 라벨만 비운다.
      .catch(() => (appVersion = ""));
  });

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
    <div
      class="settings-modal"
      data-lapis="settings"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <!--
        디스코드 설정 문법 — 왼쪽 카테고리, 오른쪽 그 카테고리의 항목들.

        예전엔 섹션 일곱이 한 줄로 나열돼 있었다. 항목이 늘수록 스크롤만 길어지고,
        "어디에 있더라"를 매번 훑어야 했다.

        ⚠️ 버전이 카테고리 목록 **하단**에 있다. B단계에서 전역 상단바를 없애며 노트
        헤더로 옮겨 뒀던 것을 여기로 데려왔다 — 디스코드가 버전을 두는 자리고,
        노트를 볼 때마다 보일 이유가 없는 정보다.
      -->
      <nav class="settings-nav" aria-label={m.settings_title()}>
        {#each CATEGORIES as c (c.id)}
          <button
            type="button"
            class="cat"
            class:active={cat === c.id}
            aria-pressed={cat === c.id}
            onclick={() => (cat = c.id)}
          >
            {c.label()}
          </button>
        {/each}
        <div class="nav-spacer"></div>
        {#if appVersion}
          <span class="nav-version">v{appVersion}</span>
        {/if}
      </nav>

      <div class="settings-pane">
        <header class="settings-head">
          <h2 id="settings-title">{activeLabel()}</h2>
          <button
            class="btn btn--icon btn--sm btn--plain"
            aria-label={m.settings_close()}
            onclick={closeSettings}
          >×</button>
        </header>

        <div class="settings-body">
        {#if cat === "appearance"}
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
        {/if}
        {#if cat === "language"}
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
        {/if}
        {#if cat === "vault"}
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
        {/if}
        {#if cat === "advanced"}
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
          <!-- 사용자 정의 CSS 는 아래 CustomCssEditor 가 담당한다. -->
          <CustomCssEditor />
        {/if}
        </div>

        <footer class="settings-foot">
          <button class="btn btn--ghost" onclick={closeSettings}>{m.settings_close()}</button>
        </footer>
      </div>
    </div>
  </ModalShell>
{/if}

<style>
  /* 디스코드 설정 문법 — 왼쪽 카테고리 목록, 오른쪽 그 카테고리의 항목들.
     ⚠️ 예전엔 `flex-direction: column`이었다(머리 → 본문 → 발). 카테고리를 넣으면서
     가로 2단이 됐고, 세로 쌓기는 오른쪽 `.settings-pane` 안으로 내려갔다. */
  .settings-modal {
    background: var(--surface-raised);
    border: 1px solid var(--border-default);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-overlay);
    color: var(--text-primary);
    width: 100%;
    /* 2단이 되면서 넓어져야 한다 — lg(540px)로는 목록과 본문이 같이 안 들어간다. */
    max-width: 760px;
    display: flex;
    overflow: hidden;
  }

  .settings-nav {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    flex: 0 0 176px;
    padding: var(--sp-5) var(--sp-4);
    /* 셸 3계층과 같은 어휘 — 목록이 본문보다 어둡다. */
    background: var(--surface-panel);
  }

  .cat {
    padding: var(--sp-3) var(--sp-4);
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-secondary);
    font-family: inherit;
    font-size: var(--fs-base);
    text-align: left;
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-standard),
      color var(--dur-fast) var(--ease-standard);
  }
  .cat:hover {
    background: var(--surface-overlay);
    color: var(--text-primary);
  }
  /* 디스코드 채널 아이템과 같다 — 선택은 배경으로 말한다. */
  .cat.active {
    background: var(--accent-bg-subtle);
    color: var(--text-primary);
  }

  .nav-spacer {
    flex: 1;
  }

  /* 버전 — 디스코드가 버전을 두는 자리. B단계에서 노트 헤더로 옮겼던 것을 여기로. */
  .nav-version {
    padding: 0 var(--sp-4);
    color: var(--text-disabled);
    font-size: var(--fs-xs);
  }

  .settings-pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
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
