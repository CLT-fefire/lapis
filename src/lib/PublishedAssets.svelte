<script lang="ts">
  import { logWarn } from "$lib/stores/usage";
  import { m } from "$lib/paraglide/messages.js";
  import { invoke } from "$lib/tauri/invoke";
import { convertFileSrc } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { vaultPath } from "$lib/stores/vault";
  import { findAssetsForNote, type AssetInfo } from "$lib/tauri/notes";

  interface Props {
    notePath: string | null;
  }
  let { notePath }: Props = $props();

  let assets = $state<AssetInfo[]>([]);
  let loading = $state(false);

  $effect(() => {
    const path = notePath;
    const vault = $vaultPath;
    if (!path || !vault) {
      assets = [];
      return;
    }
    loading = true;
    (async () => {
      try {
        const list = await findAssetsForNote(vault, path);
        assets = list;
      } catch (e) {
        logWarn("PublishedAssets", "find_assets_for_note failed", e);
        assets = [];
      } finally {
        loading = false;
      }
    })();
  });

  async function openInSystem(asset: AssetInfo) {
    try {
      await openUrl(`file://${asset.abs_path}`);
    } catch (e) {
      logWarn("PublishedAssets", "openUrl failed", e);
    }
  }
</script>

{#if assets.length > 0}
  <section class="published">
    <h3>↧ Published · {assets.length}</h3>
    <div class="thumbs">
      {#each assets as a (a.abs_path)}
        <button
          class="thumb"
          type="button"
          title={m.assets_open_title({ name: a.name })}
          onclick={() => openInSystem(a)}
        >
          <img src={convertFileSrc(a.abs_path)} alt={a.name} loading="lazy" />
          <span class="caption">{a.name}</span>
        </button>
      {/each}
    </div>
  </section>
{/if}

<style>
  .published {
    margin-top: 28px;
    padding-top: 18px;
    border-top: 1px solid var(--border-default);
  }

  .published h3 {
    font-size: var(--fs-xs);
    letter-spacing: 0.01em;
    color: var(--text-muted);
    margin: 0 0 10px 0;
    font-weight: 600;
  }

  .thumbs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-5);
  }

  .thumb {
    background: var(--surface-sunken);
    border: 1px solid var(--accent-border);
    border-radius: var(--r-md);
    padding: var(--sp-4);
    cursor: pointer;
    font-family: inherit;
    color: var(--text-secondary);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-3);
    max-width: 160px;
    transition: border-color 0.15s, background 0.15s;
  }

  .thumb:hover {
    border-color: var(--accent);
    background: var(--accent-bg-subtle);
  }

  .thumb img {
    max-width: 140px;
    max-height: 100px;
    width: auto;
    height: auto;
    object-fit: contain;
    background: var(--surface-overlay);
    border-radius: var(--r-xs);
  }

  .caption {
    font-size: var(--fs-xs);
    color: var(--text-secondary);
    max-width: 140px;
    /* overflow:hidden + line-height 미지정은 한글 받침을 자른다(OutlinePanel과 같은 건). */
    line-height: 1.5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .thumb:hover .caption {
    color: var(--text-primary);
  }
</style>
