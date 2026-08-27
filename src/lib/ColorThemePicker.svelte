<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { COLOR_THEMES, BASE_RAMP, tintNeutral, accentForeground } from "$lib/colorThemes";
  import { colorTheme, applyColorTheme } from "$lib/stores/settings";

  /**
   * 색 테마 고르기.
   *
   * ⚠️ 스와치는 **실제로 적용될 색**으로 그린다. 예쁜 대표색을 따로 두면 고른 뒤에 화면이
   * 다르게 나오고, 그 어긋남은 아무 에러도 안 낸다.
   */

  function swatch(id: string): { surface: string; accent: string; fg: string } {
    const t = COLOR_THEMES.find((x) => x.id === id)!;
    const surface = t.tint
      ? tintNeutral(BASE_RAMP["--n-300"], t.tint, t.tintStrength ?? 0.22)
      : BASE_RAMP["--n-300"];
    return { surface, accent: t.accent, fg: accentForeground(t.accent) };
  }

  /** 색조가 있는지 — 목록을 두 묶음으로 나눈다. */
  const plain = COLOR_THEMES.filter((t) => !t.tint);
  const tinted = COLOR_THEMES.filter((t) => t.tint);
</script>

<section class="setting-row theme-row">
  <div class="setting-label">
    <span class="label-text">
      <span class="label-title">{m.settings_theme_color_title()}</span>
      <span class="label-desc">{m.settings_theme_color_desc()}</span>
    </span>
  </div>

  <div class="theme-control">
    {#each [{ label: m.settings_theme_group_accent(), items: plain }, { label: m.settings_theme_group_tinted(), items: tinted }] as group (group.label)}
      <div class="group-label">{group.label}</div>
      <div class="grid">
        {#each group.items as t (t.id)}
          {@const s = swatch(t.id)}
          <button
            type="button"
            class="swatch"
            class:active={$colorTheme === t.id}
            aria-pressed={$colorTheme === t.id}
            title={t.name}
            style="--sw-surface: {s.surface}; --sw-accent: {s.accent}; --sw-fg: {s.fg};"
            onclick={() => void applyColorTheme(t.id)}
          >
            <span class="chip" aria-hidden="true"></span>
            <span class="name">{t.name}</span>
          </button>
        {/each}
      </div>
    {/each}
    <p class="note">{m.settings_theme_color_note()}</p>
  </div>
</section>

<style>
  .theme-row {
    flex-direction: column;
    align-items: stretch;
    gap: var(--sp-4);
  }

  .theme-control {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }

  .group-label {
    color: var(--text-muted);
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: var(--sp-3);
  }

  .swatch {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3);
    border: 1px solid var(--border-default);
    border-radius: var(--r-md);
    /* 스와치 배경 자체가 그 테마의 본문 색이다 — 고르기 전에 어떤 면이 될지 보인다. */
    background: var(--sw-surface);
    color: var(--text-primary);
    font-family: inherit;
    font-size: var(--fs-sm);
    cursor: pointer;
    transition:
      border-color var(--dur-fast) var(--ease-standard),
      transform var(--dur-fast) var(--ease-standard);
  }
  .swatch:hover {
    border-color: var(--sw-accent);
  }
  .swatch.active {
    border-color: var(--sw-accent);
    box-shadow: 0 0 0 1px var(--sw-accent);
  }

  .chip {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    border-radius: var(--r-full);
    background: var(--sw-accent);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-xs);
    line-height: 1.5;
  }
</style>
