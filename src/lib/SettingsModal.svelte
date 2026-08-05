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
  } from "$lib/stores/settings";
  import { themeMode, setTheme, type ThemeMode } from "$lib/stores/theme";
  import { density, setDensity, type Density } from "$lib/stores/density";
  import {
    readingMeasureLimited,
    setReadingMeasureLimited,
  } from "$lib/stores/reading";
  import { vaultPath, forceReindex } from "$lib/stores/vault";
  import { gitRepo, gitBusy, startVersioning, refreshGitStatus } from "$lib/stores/git";
  import { get } from "svelte/store";

  const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
    { value: "system", label: "시스템" },
    { value: "light", label: "라이트" },
    { value: "dark", label: "다크" },
  ];

  const DENSITY_OPTIONS: { value: Density; label: string }[] = [
    { value: "default", label: "기본" },
    { value: "compact", label: "촘촘하게" },
  ];

  const MEASURE_OPTIONS: { value: boolean; label: string }[] = [
    { value: true, label: "제한" },
    { value: false, label: "전체 폭" },
  ];

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
    gitHint = $gitRepo ? "버전관리를 시작했습니다 — 변경 시 자동으로 커밋됩니다." : "시작 실패 — 콘솔 확인";
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
  <ModalShell onClose={closeSettings} label="설정">
    <div class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header class="settings-head">
        <h2 id="settings-title">설정</h2>
        <button class="btn btn--icon btn--sm btn--plain" aria-label="닫기" onclick={closeSettings}>×</button>
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
          <div class="setting-label number">
            <span class="label-text">
              <span class="label-title">밀도</span>
              <span class="label-desc">
                사이드바·목록·버튼의 여백을 조절합니다. "촘촘하게"는 한 화면에 더 많은 항목을
                보여줍니다(글자 크기는 그대로).
              </span>
            </span>
          </div>
          <div class="setting-control">
            <div class="segmented" role="group" aria-label="밀도 선택">
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
              <span class="label-title">본문 폭</span>
              <span class="label-desc">
                프리뷰 본문을 읽기 좋은 폭(한 줄 약 38자)으로 제한하고 가운데 정렬합니다.
                창이 넓을수록 한 줄이 길어져 줄을 놓치기 쉬워집니다. 표는 이 폭에 맞춰
                줄어들고, 코드 블록처럼 더 줄일 수 없는 내용은 자체 가로 스크롤이 생깁니다.
                내보낸 HTML도 이 설정을 따릅니다. 글자 크기는 Preview 툴바의
                <strong>Aa</strong>에서 조절합니다.
              </span>
            </span>
          </div>
          <div class="setting-control">
            <div class="segmented" role="group" aria-label="본문 폭 선택">
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
              disabled={backupKeepSaving}
              aria-label="링크 갱신 백업 보존 개수"
            />
          </div>
        </section>

        <section class="setting-row">
          <div class="setting-label number">
            <span class="label-text">
              <span class="label-title">Git 버전관리</span>
              <span class="label-desc">
                vault 변경을 자동으로 커밋해 이력을 남깁니다(노트 하단 <strong>History</strong>에서 확인).
                <code>_memories</code> 등은 제외하고 로컬 <code>.git</code>만 생성합니다.
              </span>
              {#if gitHint}
                <span class="label-hint">{gitHint}</span>
              {/if}
            </span>
          </div>
          <div class="setting-control">
            {#if !$vaultPath}
              <span class="setting-status">vault 없음</span>
            {:else if $gitRepo}
              <span class="setting-status on">활성</span>
            {:else}
              <button
                class="btn btn--primary btn--sm"
                disabled={$gitBusy}
                onclick={onStartVersioning}
              >
                {$gitBusy ? "시작 중…" : "버전관리 시작"}
              </button>
            {/if}
          </div>
        </section>

        <section class="setting-row">
          <div class="setting-label number">
            <span class="label-text">
              <span class="label-title">인덱스 재구축</span>
              <span class="label-desc">
                검색·태그·관계 인덱스를 캐시를 무시하고 처음부터 다시 만듭니다. 외부에서 문서나
                속성을 대량으로 바꿨는데 검색에 반영이 안 될 때 사용하세요.
                <strong>보통은 자동 반영</strong>되므로 평소엔 필요 없습니다. 누르면 설정이 닫히고
                사이드바에 진행 표시가 나타납니다(완료까지 검색은 잠시 막힘, 읽기는 계속 가능).
              </span>
            </span>
          </div>
          <div class="setting-control">
            {#if !$vaultPath}
              <span class="setting-status">vault 없음</span>
            {:else}
              <button class="btn btn--sm" onclick={onRebuildIndex}>재구축</button>
            {/if}
          </div>
        </section>
      </div>

      <footer class="settings-foot">
        <button class="btn btn--ghost" onclick={closeSettings}>닫기</button>
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
  .label-text code {
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
