<script lang="ts">
  import { logError } from "$lib/stores/usage";
  import { recencyAxis, setRecencyAxis } from "$lib/stores/palette";
  import ModalShell from "$lib/ModalShell.svelte";
  import CustomCssEditor from "$lib/CustomCssEditor.svelte";
  import { usageEnabled, usageDropped, flushUsage } from "$lib/stores/usage";
  import { usageMonths, usageRead, usageClear } from "$lib/tauri/usage";
  import { UsageAnalyzer } from "$lib/usageAnalyzer";
  import { buildUsageReport } from "$lib/usageReport";
  import { buildUsageJsonl, suggestUsageFileName } from "$lib/usageExport";
  import { BUILTIN_COMMANDS } from "$lib/commands";
  import { save } from "@tauri-apps/plugin-dialog";
  import { writeBinaryFile } from "$lib/tauri/notes";
  import ColorThemePicker from "$lib/ColorThemePicker.svelte";
  import { searchSettings, type SettingsCatId } from "$lib/settingsIndex";
  import { settingsPaths, type SettingsPaths } from "$lib/tauri/settings";
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
  import { motionPref, setMotionPref, type MotionPref } from "$lib/stores/motionPref";
  import {
    chromeMode,
    setChromeMode,
    chromeSwitchable,
    type ChromeMode,
  } from "$lib/stores/chrome";
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

  /**
   * 설정 검색.
   *
   * ⚠️ 카테고리를 **가로지른다** — 그게 요점이다. 항목이 어느 카테고리에 있는지
   * 알면 검색할 이유가 없다. 그래서 결과에 카테고리 이름을 같이 낸다.
   *
   * ⚠️ 카테고리 내용을 필터하지 않고 **결과 목록으로 갈아 끼운다.** 안 보는
   * 카테고리는 `{#if}` 라서 DOM에 없고, 그 덕에 무거운 CodeMirror가 그 탭을 열
   * 때만 뜬다. 검색 하나 때문에 그걸 포기하지 않는다.
   */
  let query = $state("");
  const results = $derived(searchSettings(query, (k) => label(k)));

  /**
   * 메시지 키 → 표시 문자열. paraglide는 키별 함수라 동적 조회가 안 된다 —
   * ⚠️ 없는 키를 `m[k]`로 부르면 **런타임에 죽는 게 아니라 undefined 호출**이다.
   * 가드(`settingsSearch.test.ts`)가 색인의 키가 실재하는지 본다.
   */
  function label(key: string): string {
    const fn = (m as unknown as Record<string, (() => string) | undefined>)[key];
    return typeof fn === "function" ? fn() : "";
  }

  const CAT_LABEL = (id: SettingsCatId) =>
    CATEGORIES.find((c) => c.id === id)?.label() ?? id;

  function goTo(id: SettingsCatId) {
    cat = id as CatId;
    query = "";
  }
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

  /** ⚠️ 순서가 화면 순서다 — 여유에서 조밀로. `DENSITIES` 와 같아야 한다. */
  const DENSITY_OPTIONS: { value: Density; label: string }[] = [
    { value: "cozy", label: m.settings_density_cozy() },
    { value: "default", label: m.settings_density_default() },
    { value: "compact", label: m.settings_density_compact() },
  ];

  const MOTION_OPTIONS: { value: MotionPref; label: string }[] = [
    { value: "system", label: m.settings_motion_system() },
    { value: "minimal", label: m.settings_motion_minimal() },
    { value: "full", label: m.settings_motion_full() },
  ];

  const CHROME_OPTIONS: { value: ChromeMode; label: string }[] = [
    { value: "custom", label: m.settings_chrome_custom() },
    { value: "native", label: m.settings_chrome_native() },
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

  /**
   * MCP 게이트가 **실제로 읽는 파일**.
   *
   * ⚠️ dev 빌드는 `-dev` 파일에 쓰는데 게이트는 릴리즈를 먼저 본다. 그러면 여기서
   * 켜도 MCP 에는 안 닿는다 — 결함이 아닌데 결함과 똑같이 보인다. 실제로 그 구분에
   * 시간을 썼다. 경로를 눈에 보이게 두는 것이 그 시간을 없앤다.
   */
  let paths = $state<SettingsPaths | null>(null);
  $effect(() => {
    if (!$settingsOpen) return;
    void settingsPaths()
      .then((p) => (paths = p))
      // 못 읽으면 줄을 안 띄운다 — 틀린 경로를 보여주는 것보다 낫다.
      .catch(() => (paths = null));
  });

  /**
   * ⚠️ **같은 값이어도 쓴다.** 예전에는 `if ($mcpEnabled === v) return;` 로 걸렀는데,
   * store 와 디스크가 어긋나면 **되돌릴 유일한 조작이 아무 일도 안 하고 아무 말도
   * 안 했다.** "허용을 눌렀는데 안 켜진다"의 정체가 그것이다.
   *
   * 같은 값을 다시 쓰는 비용은 파일 하나이고, 그 대신 화면과 디스크가 다시 맞는다.
   */
  async function setMcp(v: boolean) {
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
      logError("SettingsModal", "[Settings] backup_keep apply failed", e);
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
      // 사용 기록의 크기·경로는 열 때마다 다시 읽는다 — 지우고 나면 바로 반영돼야 한다.
      usageNote = "";
      void refreshUsage();
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
    void forceReindex().catch((e) => logError("SettingsModal", "[Settings] rebuild index failed", e));
  }
  // ─── 사용 기록 ───────────────────────────────────────────────────────────
  //
  // ⚠️ 여기는 **보는 쪽**이다. 기록은 `stores/usage.ts` 가 하고, 집계와 가림은
  //    `usageEvent.ts` · `usageReport.ts` 가 한다 — 화면이 판정을 하면 CLI 와 갈린다.
  let usageDir = $state("");
  let usageSize = $state(0);
  let usageMonthList = $state<string[]>([]);
  let usageNote = $state("");

  async function refreshUsage(): Promise<void> {
    try {
      const r = await usageMonths();
      usageDir = r.dir;
      usageSize = r.total_bytes;
      usageMonthList = r.months;
    } catch {
      // Tauri 밖(프리뷰)에서는 조용히 비운다 — 설정이 안 열리면 안 된다.
      usageDir = "";
      usageMonthList = [];
    }
  }

  function humanSize(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  /**
   * 무엇을 저장할지.
   *
   * ⚠️ 기본이 **원본**이다. 이 기능의 목적이 "나중에 기능 개선에 쓴다"이고, 마크다운 표는
   * 다시 파싱해 분석하는 사람이 없다.
   */
  let usageFormat = $state<"jsonl" | "md">("jsonl");
  /** ⚠️ 기본이 **끔**. 가림은 공개된 곳에 붙여넣을 때만 켠다. */
  let usageHide = $state(false);

  async function saveUsage(): Promise<void> {
    usageNote = "";
    try {
      // ⚠️ 버퍼를 먼저 내린다 — 안 그러면 방금 한 일이 결과에 없다.
      await flushUsage();
      await refreshUsage();
      if (usageMonthList.length === 0) {
        usageNote = m.settings_usage_empty();
        return;
      }
      const text =
        usageFormat === "jsonl" ? await buildRawJsonl() : await buildMarkdownReport();
      if (text === null) return;
      const target = await save({
        defaultPath: suggestUsageFileName(usageMonthList, usageFormat),
        filters:
          usageFormat === "jsonl"
            ? [{ name: "JSON Lines", extensions: ["jsonl"] }]
            : [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!target) return;
      await writeBinaryFile(target, new TextEncoder().encode(text));
      usageNote = m.settings_usage_saved({ path: target });
    } catch (e) {
      logError("SettingsModal", "사용 기록 저장 실패", e);
      usageNote = String(e);
    }
  }

  /**
   * 🔴 **원본은 그대로 잇는다.** 파싱해서 다시 쓰면 못 읽은 줄이 조용히 사라지고,
   * 그러면 내보낸 파일이 디스크의 진실과 달라진다.
   */
  async function buildRawJsonl(): Promise<string | null> {
    const months: { month: string; lines: string[] }[] = [];
    for (const mo of usageMonthList) months.push({ month: mo, lines: await usageRead(mo) });
    const text = buildUsageJsonl(months);
    if (text === "") {
      usageNote = m.settings_usage_empty();
      return null;
    }
    return text;
  }

  /**
   * 읽는 용도의 요약.
   *
   * 🔴 **달을 하나씩 흘려보낸다.** 예전엔 모든 달을 한 배열로 모았는데, 월 파일 상한이
   * 16 MB 라 열두 달이면 최악 192 MB 의 문자열 배열이었다. 담는 종류가 늘수록 빨리 커진다 —
   * 그래서 `UsageAnalyzer` 가 상태를 들고 한 줄씩 받는다.
   */
  async function buildMarkdownReport(): Promise<string | null> {
    const analyzer = new UsageAnalyzer({ knownCommands: BUILTIN_COMMANDS.map((c) => c.id) });
    let any = false;
    for (const mo of usageMonthList) {
      const lines = await usageRead(mo);
      if (lines.length > 0) any = true;
      analyzer.feedAll(lines);
    }
    if (!any) {
      usageNote = m.settings_usage_empty();
      return null;
    }
    const label =
      usageMonthList.length === 1
        ? usageMonthList[0]
        : `${usageMonthList.at(-1)} ~ ${usageMonthList[0]}`;
    // ⚠️ `raw` 는 **가리지 않음**이다. 체크박스가 켜졌을 때만 가린다.
    return buildUsageReport(analyzer.result(), { raw: !usageHide, label });
  }

  async function clearUsage(): Promise<void> {
    usageNote = "";
    try {
      const n = await usageClear();
      await refreshUsage();
      usageNote = m.settings_usage_cleared({ count: n });
    } catch (e) {
      logError("SettingsModal", "사용 기록 지우기 실패", e);
      usageNote = String(e);
    }
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
          <input
            class="settings-search"
            type="search"
            bind:value={query}
            placeholder={m.settings_search_placeholder()}
            aria-label={m.settings_search_aria()}
          />
          <button
            class="btn btn--icon btn--sm btn--plain"
            aria-label={m.settings_close()}
            onclick={closeSettings}
          >×</button>
        </header>

        <div class="settings-body">
        {#if query.trim()}
          {#if results.length === 0}
            <p class="search-empty">{m.settings_search_empty()}</p>
          {:else}
            <ul class="search-results">
              {#each results as r (r.key)}
                <li>
                  <button type="button" class="search-hit" onclick={() => goTo(r.cat)}>
                    <span class="hit-title">{label(r.key)}</span>
                    <span class="hit-cat">{CAT_LABEL(r.cat)}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {:else}
        {#if cat === "appearance"}
          <ColorThemePicker />
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
              <span class="label-title">{m.settings_motion_label()}</span>
              <span class="label-desc">{m.settings_motion_hint()}</span>
            </span>
          </div>
          <div class="setting-control">
            <div class="segmented" role="group" aria-label={m.settings_motion_label()}>
              {#each MOTION_OPTIONS as opt (opt.value)}
                <button
                  type="button"
                  class="segment"
                  class:active={$motionPref === opt.value}
                  aria-pressed={$motionPref === opt.value}
                  onclick={() => setMotionPref(opt.value)}
                >
                  {opt.label}
                </button>
              {/each}
            </div>
          </div>
        </section>

        <!-- ⚠️ macOS 에서는 이 행을 안 그린다. 거기서 이 스위치는 아무 일도 못 하는데
             (`stores/chrome.ts` 참조), 눌리는데 아무 일도 안 일어나는 컨트롤은
             고장과 구별이 안 된다. -->
        {#if chromeSwitchable()}
        <section class="setting-row">
          <div class="setting-label number">
            <span class="label-text">
              <span class="label-title">{m.settings_chrome_label()}</span>
              <span class="label-desc">{m.settings_chrome_hint()}</span>
              <span class="label-desc">{m.settings_chrome_restart()}</span>
            </span>
          </div>
          <div class="setting-control">
            <div class="segmented" role="group" aria-label={m.settings_chrome_label()}>
              {#each CHROME_OPTIONS as opt (opt.value)}
                <button
                  type="button"
                  class="segment"
                  class:active={$chromeMode === opt.value}
                  aria-pressed={$chromeMode === opt.value}
                  onclick={() => setChromeMode(opt.value)}
                >
                  {opt.label}
                </button>
              {/each}
            </div>
          </div>
        </section>
        {/if}

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
        <!--
          ⚠️ CLI·MCP 는 `--by mtime|date` 로 둘 다 받는데 앱은 mtime 고정이었다.
          실측: date 가 있는 107노트 중 **42건이 mtime 과 날짜가 다르다** — 두 축은
          이 vault 에서 실제로 갈린다.
        -->
        <section class="setting-row">
          <div class="setting-label number">
            <span class="label-text">
              <span class="label-title">{m.settings_recency_title()}</span>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <span class="label-desc">{@html m.settings_recency_desc()}</span>
            </span>
          </div>
          <div class="setting-control">
            <div class="segmented" role="group" aria-label={m.settings_recency_aria()}>
              <button
                type="button"
                class="segment"
                class:active={$recencyAxis === "mtime"}
                aria-pressed={$recencyAxis === "mtime"}
                onclick={() => setRecencyAxis("mtime")}>{m.settings_recency_mtime()}</button
              >
              <button
                type="button"
                class="segment"
                class:active={$recencyAxis === "date"}
                aria-pressed={$recencyAxis === "date"}
                onclick={() => setRecencyAxis("date")}>{m.settings_recency_date()}</button
              >
            </div>
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
              {#if paths}
                <span class="label-hint" class:split={!paths.same}>
                  {paths.same
                    ? m.settings_mcp_paths_same({ path: paths.writes })
                    : m.settings_mcp_paths_split({
                        writes: paths.writes,
                        reads: paths.mcp_reads,
                      })}
                </span>
              {/if}
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
              <span class="label-title">{m.settings_usage_title()}</span>
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <span class="label-desc">{@html m.settings_usage_desc()}</span>
              <span class="label-hint">{m.settings_usage_warn()}</span>
              {#if usageDir}
                <span class="label-hint">
                  {m.settings_usage_where({ dir: usageDir, size: humanSize(usageSize) })}
                </span>
              {/if}
              {#if $usageDropped > 0}
                <span class="label-hint">{m.settings_usage_dropped({ count: $usageDropped })}</span>
              {/if}
              {#if usageNote}<span class="label-hint">{usageNote}</span>{/if}
            </span>
          </div>
          <div class="setting-control usage-controls">
            <div class="segmented" role="group" aria-label={m.settings_usage_title()}>
              <button
                type="button"
                class="segment"
                class:active={$usageEnabled}
                aria-pressed={$usageEnabled}
                onclick={() => usageEnabled.set(true)}>{m.settings_usage_on()}</button
              >
              <button
                type="button"
                class="segment"
                class:active={!$usageEnabled}
                aria-pressed={!$usageEnabled}
                onclick={() => usageEnabled.set(false)}>{m.settings_usage_off()}</button
              >
            </div>
            <!--
              ⚠️ **버튼 하나.** 예전엔 "리포트 저장"과 "가리지 않고 저장"이 나란히 있어서
              눌러 보기 전엔 뭐가 다른지 몰랐다. 무엇을 낼지는 형식이 정한다.
            -->
            <label class="usage-format">
              <span class="usage-format-label">{m.settings_usage_format_label()}</span>
              <select bind:value={usageFormat}>
                <option value="jsonl">{m.settings_usage_format_jsonl()}</option>
                <option value="md">{m.settings_usage_format_md()}</option>
              </select>
            </label>
            <!--
              ⚠️ **기본은 가리지 않음.** 저장은 사용자가 고른 위치로 나가는 로컬 파일이고,
              위험은 저장이 아니라 나중의 붙여넣기에 있다. 비용을 매번 낼 이유가 없다.
            -->
            {#if usageFormat === "md"}
              <label class="usage-hide" title={m.settings_usage_hide_title()}>
                <input type="checkbox" bind:checked={usageHide} />
                <span>{m.settings_usage_hide()}</span>
              </label>
            {:else}
              <span class="usage-raw-note">{m.settings_usage_raw_note()}</span>
            {/if}
            <button type="button" class="btn btn--sm" onclick={saveUsage}>
              {m.settings_usage_save()}
            </button>
            <button type="button" class="btn btn--sm btn--plain" onclick={clearUsage}>
              {m.settings_usage_clear()}
            </button>
          </div>
        </section>

          <!-- 사용자 정의 CSS 는 아래 CustomCssEditor 가 담당한다. -->
          <CustomCssEditor />
        {/if}
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

  /* ⚠️ 박스 사이 여백은 **여기서만** 준다.
     `.setting-row`가 배경·보더·라운드를 가진 카드인데 컨테이너에 `gap`이 없어서
     카드들이 딱 붙어 한 덩어리로 보였다. 카드에 `margin`을 주는 대신 컨테이너가
     간격을 쥐어야 첫/마지막 카드에 여백이 새지 않는다. */
  /* 검색 — 헤더에 둔다. 카테고리 목록 쪽에 두면 "이 카테고리 안에서 찾는다"로 읽힌다. */
  .settings-search {
    margin-left: auto;
    margin-right: var(--sp-3);
    min-width: 0;
    width: 180px;
    background: var(--surface-sunken);
    border: 1px solid var(--border-default);
    border-radius: var(--r-sm);
    color: var(--text-primary);
    padding: 4px 8px;
    font-size: 0.85rem;
  }

  .settings-search::placeholder {
    color: var(--text-muted);
  }

  .search-results {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .search-hit {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--sp-3);
    width: 100%;
    background: none;
    border: none;
    border-radius: var(--r-sm);
    padding: var(--sp-3);
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
  }

  .search-hit:hover {
    background: var(--surface-sunken);
  }

  /* ⚠️ 카테고리 이름이 결과의 절반이다 — 어디로 가는지 모르면 눌러도 길을 잃는다. */
  .hit-cat {
    color: var(--text-muted);
    font-size: 0.8rem;
    white-space: nowrap;
  }

  /* ⚠️ 경로가 갈렸다는 것은 힌트가 아니라 경고다 — 회색으로 두면 안 읽힌다. */
  .label-hint.split {
    color: var(--warning);
  }

  .search-empty {
    color: var(--text-muted);
    padding: var(--sp-3);
  }

  .settings-body {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
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
    color: var(--accent-text);
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
  /* 저장 형식·가림 — 버튼 줄에 나란히 선다. */
  .usage-format,
  .usage-hide {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .usage-format-label {
    color: var(--text-muted);
  }

  .usage-format select {
    padding: var(--sp-1) var(--sp-2);
    border: 1px solid var(--border-default);
    border-radius: var(--r-sm);
    background: var(--surface-sunken);
    color: var(--text-primary);
    font-size: var(--fs-xs);
    font-family: inherit;
  }

  /*
    원본을 고르면 가림 체크박스 대신 이 줄이 선다 — 왜 체크박스가 사라졌는지 말해 주지
    않으면 "가림이 꺼진 채로 저장됐다"고 오해한다.
  */
  .usage-raw-note {
    font-size: var(--fs-xs);
    color: var(--text-muted);
    max-width: 34ch;
    line-height: 1.4;
  }

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
    color: var(--accent-text);
  }
</style>
