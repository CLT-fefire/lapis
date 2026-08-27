<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { ChevronDown, Search, PanelRight } from "@lucide/svelte";
  import PaneMenu, { type PaneMenuItem } from "./PaneMenu.svelte";
  import {
    vaultPath,
    reloadNotes,
    forceReindex,
    pickAndOpenVault,
    indexBuilding,
    indexRefreshing,
  } from "$lib/stores/vault";
  import { buildProgress } from "$lib/stores/search";
  import { revealInFinder } from "$lib/tauri/reveal";
  import { openSettings } from "$lib/stores/settings";
  import { openPaletteAtLastMode } from "$lib/stores/palette";
  import { contextCollapsed, toggleContext } from "$lib/stores/layout";
  import { chromeMode, needsCaptionButtons } from "$lib/stores/chrome";
  import CaptionButtons from "./CaptionButtons.svelte";

  /**
   * 상단바 — 창 폭 전체를 가로지르는 셸의 첫 줄.
   *
   * ## ⚠️ v2.0.0 이 없앤 것을 왜 되살리나
   *
   * v2.0.0 B단계에서 전역 상단바를 해체해 노트 헤더로 합쳤다. 디스코드에 전역 상단바가
   * 없다는 이유였다. 쓰다 보니 **디스코드에는 없는 것이 lapis 에는 있었다** — vault 라는
   * 전역 대상, 인덱싱이라는 전역 작업, 창 하나에 vault 하나라는 규칙.
   *
   * 그 셋은 노트에 딸린 정보가 아니라 **창에 딸린 정보**다. 노트 헤더에 두면 노트를
   * 안 열었을 때 갈 곳이 없다.
   *
   * ⚠️ 브랜드는 여전히 없다. 자기 앱 이름을 상시 표시할 이유가 없다는 판단은 그대로다.
   *
   * ## 드래그 영역
   *
   * ⚠️ `data-tauri-drag-region` 은 **빈 공간에만** 준다. 컨트롤에 주면 클릭이 드래그로
   * 먹혀 버튼이 안 눌린다. 크롬을 끄면(`chromeMode = "custom"`) 이 영역이 **유일한
   * 이동 수단**이 된다.
   *
   * ## 캡션 버튼
   *
   * ⚠️ Windows 에서만 그린다. macOS 는 신호등이 오버레이로 남으므로 우리가 그리면 두
   * 벌이 된다 — 대신 왼쪽에 신호등 자리(78px)를 비운다.
   */

  const vaultMenuItems: PaneMenuItem[] = [
    { id: "reload", label: m.sidebar_menu_refresh(), onSelect: () => void reloadNotes() },
    {
      id: "reveal",
      label: m.sidebar_menu_reveal(),
      onSelect: () => {
        if ($vaultPath) void revealInFinder($vaultPath);
      },
    },
    {
      id: "open-other",
      label: m.sidebar_menu_open_other(),
      onSelect: () => void pickAndOpenVault(),
    },
    {
      id: "reindex",
      label: m.sidebar_menu_reindex(),
      title: m.sidebar_menu_reindex_desc(),
      onSelect: () => void forceReindex(),
    },
    { id: "settings", label: m.sidebar_menu_settings(), onSelect: openSettings },
  ];

  const vaultName = $derived(
    $vaultPath ? ($vaultPath.split("/").filter(Boolean).pop() ?? $vaultPath) : null,
  );

  /**
   * 인덱싱 pill — **실측 진행**이다.
   *
   * ⚠️ 예전 `progress-strip` 은 무한 슬라이딩 바였다. 그건 "돌고 있다"만 말하고
   * "얼마나 남았나"는 말해 주지 않는다 — 12,000 노트에서 그 차이가 크다.
   * `buildProgress` 가 done/total 을 들고 있는데 화면이 안 쓰고 있었다.
   */
  const progress = $derived.by(() => {
    const b = $buildProgress;
    if (!b || b.total <= 0) return null;
    return { done: b.done, total: b.total, pct: Math.min(100, (b.done / b.total) * 100) };
  });

  const busy = $derived($indexBuilding || $indexRefreshing);
</script>

<header class="titlebar" data-lapis="titlebar" data-tauri-drag-region>
  <div class="tb-left">
    {#if $vaultPath}
      <PaneMenu
        items={vaultMenuItems}
        label={m.sidebar_vault_menu()}
        triggerClass="vault-trigger"
        align="left"
      >
        {#snippet trigger()}
          <span class="vault-name" title={$vaultPath}>{vaultName}</span>
          <ChevronDown size={13} strokeWidth={2.5} aria-hidden="true" />
        {/snippet}
      </PaneMenu>
    {:else}
      <button class="btn btn--sm" onclick={pickAndOpenVault}>{m.sidebar_open_vault()}</button>
    {/if}
  </div>

  <!-- ⚠️ 가운데는 드래그 영역을 겸한다. 커맨드바 자체는 버튼이라 드래그를 안 먹는다. -->
  <div class="tb-center" data-tauri-drag-region>
    <button class="commandbar" title={m.titlebar_command_title()} onclick={() => openPaletteAtLastMode()}>
      <Search size={13} strokeWidth={2.2} aria-hidden="true" />
      <span class="cb-label">{m.titlebar_command_label()}</span>
    </button>
  </div>

  <div class="tb-right">
    {#if busy}
      <span class="index-pill" title={m.sidebar_indexing_strip()}>
        <span class="pill-dot"></span>
        {#if progress}
          <span class="pill-text">
            {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
          </span>
          <span class="pill-track">
            <span class="pill-fill" style="width: {progress.pct}%">
              <!-- ⚠️ shimmer 는 **진행과 다른 것**을 말한다. 폭은 "얼마나 왔나"이고
                   이 반짝임은 "아직 돌고 있나"다. 인덱스 빌드가 메인 스레드를 잡으면
                   폭이 한동안 멈추는데, 그때 멈춘 것과 끝난 것을 가르는 게 이것이다. -->
              <span class="progress-shimmer" aria-hidden="true"></span>
            </span>
          </span>
        {:else}
          <span class="pill-text">{m.sidebar_status_indexing()}</span>
        {/if}
      </span>
    {/if}
    <button
      class="btn btn--icon btn--sm"
      class:active={!$contextCollapsed}
      title={m.cmd_toggle_context()}
      aria-pressed={!$contextCollapsed}
      onclick={toggleContext}
    >
      <PanelRight size={15} strokeWidth={2} aria-hidden="true" />
    </button>

    {#if needsCaptionButtons($chromeMode)}
      <CaptionButtons />
    {/if}
  </div>
</header>

<style>
  .titlebar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: var(--sp-3);
    height: var(--titlebar-h);
    padding: 0 var(--sp-3);
    background: var(--surface-titlebar);
    /* ⚠️ 보더 없이 명암으로 가른다 — 3.0 토큰의 규칙. */
    color: var(--text-secondary);
    user-select: none;
  }

  .tb-left {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .tb-center {
    display: flex;
    justify-content: center;
  }

  .tb-right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--sp-2);
    min-width: 0;
  }

  .vault-name {
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 커맨드바 — 입력처럼 보이지만 버튼이다. 진짜 입력은 팔레트가 갖는다. */
  .commandbar {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    min-width: 240px;
    max-width: 420px;
    height: 26px;
    padding: 0 var(--sp-3);
    background: var(--surface-sunken);
    border: 1px solid var(--border-default);
    border-radius: var(--r-md);
    color: var(--text-muted);
    font-size: var(--fs-sm);
    cursor: pointer;
    transition:
      background var(--dur-1) var(--ease-standard),
      border-color var(--dur-1) var(--ease-standard);
  }

  .commandbar:hover {
    background: var(--surface-hover);
    border-color: var(--border-strong);
  }

  .cb-label {
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .index-pill {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    height: 22px;
    padding: 0 var(--sp-3);
    background: var(--accent-bg-subtle);
    border-radius: var(--r-full);
    color: var(--accent-text);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }

  .pill-dot {
    width: 6px;
    height: 6px;
    border-radius: var(--r-full);
    background: var(--accent-text);
    animation: pulse-dot 1.4s ease-in-out infinite;
  }

  /* ⚠️ 진행 바는 **기능 요소**다 — reduced-motion 에서도 계속 돈다. */
  .pill-track {
    width: 48px;
    height: 3px;
    border-radius: var(--r-full);
    background: var(--accent-border);
    overflow: hidden;
  }

  .pill-fill {
    display: block;
    height: 100%;
    background: var(--accent-text);
    transition: width var(--dur-2) var(--ease-standard);
    position: relative;
    overflow: hidden;
  }

  /**
   * ⚠️ 이름이 `progress-shimmer` 인 것은 우연이 아니다. `app.css` 의 reduced-motion
   * 복원 목록이 **이 이름으로** 되살린다 — "작업 중"을 알리는 기능 요소는 동작을 줄인
   * 상태에서도 돌아야 하기 때문이다. 이름을 바꾸면 조용히 멈춘다.
   *
   * ⚠️ `will-change: transform` 로 합성 승격 — 인덱스 빌드가 메인 스레드를 잡고 있을 때
   * 멈추지 않기 위해서다. 이게 없으면 "살아 있음"을 말하려던 것이 정확히 반대를 말한다.
   */
  .progress-shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent,
      color-mix(in srgb, var(--surface-content) 55%, transparent),
      transparent
    );
    animation: pill-shimmer 1.1s linear infinite;
    will-change: transform;
  }

  @keyframes pill-shimmer {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(420%);
    }
  }
</style>
