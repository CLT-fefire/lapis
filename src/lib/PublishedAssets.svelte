<script lang="ts">
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
        console.warn("find_assets_for_note failed", e);
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
      console.warn("openUrl failed", e);
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
          title={`${a.name} — 시스템 기본 뷰어로 열기`}
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
    border-top: 1px solid #333;
  }

  .published h3 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #888;
    margin: 0 0 10px 0;
    font-weight: 600;
  }

  .thumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .thumb {
    background: #1a1a1a;
    border: 1px solid #2d4a5a;
    border-radius: 6px;
    padding: 8px;
    cursor: pointer;
    font-family: inherit;
    color: #ccc;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    max-width: 160px;
    transition: border-color 0.15s, background 0.15s;
  }

  .thumb:hover {
    border-color: #6dd6ff;
    background: #1d2a33;
  }

  .thumb img {
    max-width: 140px;
    max-height: 100px;
    width: auto;
    height: auto;
    object-fit: contain;
    background: #2a2a2a;
    border-radius: 3px;
  }

  .caption {
    font-size: 11px;
    color: #aaa;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .thumb:hover .caption {
    color: #fff;
  }
</style>
