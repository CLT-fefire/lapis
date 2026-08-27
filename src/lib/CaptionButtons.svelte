<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";

  /**
   * Windows 캡션 버튼 세 개 — 최소화 · 최대화/복원 · 닫기.
   *
   * ## ⚠️ 치수는 OS 관례다, 우리 밀도가 아니다
   *
   * 46×40 은 Windows 11 의 값이다. 밀도 설정(`data-density`)을 따라가면 조밀 모드에서
   * 버튼이 작아지는데, 창 버튼은 **OS 를 흉내 내는 자리**라 앱 밀도의 대상이 아니다.
   * 닫기 hover 가 `#c42b1c` 인 것도 같은 이유다 — 토큰이 아니라 OS 색이다.
   *
   * ## ⚠️ 드래그 영역 밖이어야 한다
   *
   * 상단바가 `data-tauri-drag-region` 을 갖는데 이 버튼들이 그 안에 있으면 **클릭이
   * 창 이동으로 먹힌다.** 버튼 자체는 드래그 영역이 아니므로 괜찮지만, 감싸는 요소에
   * 드래그를 주지 않는다.
   *
   * ## ⚠️ 이 파일은 이 머신에서 검증되지 않았다
   *
   * 브라우저 프리뷰에는 `getCurrentWindow` 가 없어 세 버튼 모두 조용히 아무 일도
   * 하지 않는다. Windows 실물 창에서 손으로 봐야 한다.
   */

  let maximized = $state(false);

  async function win() {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return null;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      return getCurrentWindow();
    } catch {
      return null;
    }
  }

  $effect(() => {
    let alive = true;
    void (async () => {
      const w = await win();
      if (!w || !alive) return;
      try {
        maximized = await w.isMaximized();
        // 창 크기가 바뀔 때마다 다시 묻는다 — 최대화 여부는 버튼 모양을 정한다.
        const un = await w.onResized(() => {
          void w.isMaximized().then((v) => {
            if (alive) maximized = v;
          });
        });
        return () => un();
      } catch (e) {
        console.warn("window state watch failed", e);
      }
    })();
    return () => {
      alive = false;
    };
  });

  async function act(kind: "min" | "max" | "close") {
    const w = await win();
    if (!w) return;
    try {
      if (kind === "min") await w.minimize();
      else if (kind === "close") await w.close();
      else {
        await w.toggleMaximize();
        maximized = await w.isMaximized();
      }
    } catch (e) {
      console.warn(`window ${kind} failed`, e);
    }
  }
</script>

<div class="caption">
  <button class="cap" title={m.chrome_minimize()} aria-label={m.chrome_minimize()} onclick={() => act("min")}>
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M0 5h10" stroke="currentColor" stroke-width="1" fill="none" />
    </svg>
  </button>

  <button
    class="cap"
    title={maximized ? m.chrome_restore() : m.chrome_maximize()}
    aria-label={maximized ? m.chrome_restore() : m.chrome_maximize()}
    onclick={() => act("max")}
  >
    {#if maximized}
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M2.5 0.5h7v7h-7z" stroke="currentColor" stroke-width="1" fill="none" />
        <path d="M0.5 2.5h7v7h-7z" stroke="currentColor" stroke-width="1" fill="var(--surface-rail)" />
      </svg>
    {:else}
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M0.5 0.5h9v9h-9z" stroke="currentColor" stroke-width="1" fill="none" />
      </svg>
    {/if}
  </button>

  <button
    class="cap cap--close"
    title={m.chrome_close()}
    aria-label={m.chrome_close()}
    onclick={() => act("close")}
  >
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1" fill="none" />
    </svg>
  </button>
</div>

<style>
  .caption {
    display: flex;
    align-items: stretch;
    /* 상단바의 오른쪽 여백을 먹고 창 모서리까지 붙는다 — OS 버튼이 그 자리에 있었다. */
    margin-right: calc(-1 * var(--sp-3));
    /**
     * ⚠️ `height: 100%` 에 기대지 않는다. 부모가 `align-items: center` 면 백분율이
     * **내용 높이**를 기준으로 풀려 버튼이 절반 크기가 된다 — 실제로 그렇게 나왔고,
     * 그러면 46×40 이라는 OS 관례가 깨진다. `stretch` 는 부모 정렬과 무관하게 채운다.
     */
    align-self: stretch;
    flex: none;
  }

  /**
   * ⚠️ **밀도를 따르지 않는다.** 46×40 은 Windows 11 의 값이고, 조밀 모드에서 줄어들면
   * 44px 히트 타깃 아래로 내려간다.
   */
  .cap {
    width: 46px;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: default;
    transition: background var(--dur-1) var(--ease-standard);
  }

  .cap:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  /* OS 색이다 — 토큰으로 바꾸면 테마마다 닫기 버튼 색이 달라진다. */
  .cap--close:hover {
    background: #c42b1c;
    color: #ffffff;
  }
</style>
