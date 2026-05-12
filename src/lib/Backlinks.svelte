<script lang="ts">
  import { selectNote } from "$lib/stores/vault";
  import { fetchBacklinkContext, type BacklinkContext } from "$lib/backlinks";
  import type { LinkInfo } from "$lib/tauri/notes";

  // Props: 현재 노트의 LinkInfo + 그 노트를 가리키는 백링크 목록
  interface Props {
    targetNote: LinkInfo | null;
    backlinks: LinkInfo[];
  }
  let { targetNote, backlinks }: Props = $props();

  // 칩별 펼침 상태 + fetch 결과 상태. 한 화면에 보통 ~10개 이내라 단순 Map.
  let expanded = $state<Set<string>>(new Set());
  let contexts = $state<Map<string, BacklinkContext>>(new Map());
  let loading = $state<Set<string>>(new Set());

  // targetNote 변경 시 펼침 상태 / 로딩 상태 리셋. 캐시(contexts)는 모듈 캐시가 있으므로 유지.
  $effect(() => {
    const _ = targetNote?.source_path;
    expanded = new Set();
    loading = new Set();
  });

  async function toggle(source: LinkInfo) {
    const key = source.source_path;
    if (expanded.has(key)) {
      const next = new Set(expanded);
      next.delete(key);
      expanded = next;
      return;
    }

    const next = new Set(expanded);
    next.add(key);
    expanded = next;

    if (contexts.has(key) || !targetNote) return; // 이미 fetch됐거나 target이 없으면 건너뜀

    const nextLoading = new Set(loading);
    nextLoading.add(key);
    loading = nextLoading;

    try {
      const ctx = await fetchBacklinkContext(source, targetNote);
      const nextCtx = new Map(contexts);
      nextCtx.set(key, ctx);
      contexts = nextCtx;
    } catch (e) {
      console.warn("fetchBacklinkContext failed", e);
    } finally {
      const after = new Set(loading);
      after.delete(key);
      loading = after;
    }
  }
</script>

{#if backlinks.length > 0}
  <section class="backlinks">
    <h3>↰ Backlinks · {backlinks.length}</h3>
    <ul>
      {#each backlinks as bl (bl.source_path)}
        {@const isOpen = expanded.has(bl.source_path)}
        {@const ctx = contexts.get(bl.source_path)}
        {@const isLoading = loading.has(bl.source_path)}
        <li class:expanded={isOpen}>
          <div class="row">
            <button
              class="chevron"
              type="button"
              aria-expanded={isOpen}
              aria-label={isOpen ? "스니펫 접기" : "스니펫 펼치기"}
              title={isOpen ? "접기" : "본문 인용 위치 보기"}
              onclick={() => toggle(bl)}
            >{isOpen ? "▾" : "▸"}</button>
            <button
              class="chip"
              title={bl.source_path}
              onclick={() => selectNote(bl.source_path)}
            >
              {bl.title ?? bl.source_name}
            </button>
          </div>
          {#if isOpen}
            <div class="snippet-box">
              {#if isLoading}
                <span class="placeholder">…</span>
              {:else if ctx && ctx.matched}
                <p class="snippet">{ctx.snippet}</p>
              {:else if ctx}
                <p class="snippet no-match">본문에 직접 인용 없음 · related로 연결됨</p>
              {:else}
                <span class="placeholder">…</span>
              {/if}
              <button class="open-link" type="button" onclick={() => selectNote(bl.source_path)}>
                노트 열기 →
              </button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .backlinks {
    margin-top: 36px;
    padding-top: 18px;
    border-top: 1px solid #333;
  }

  .backlinks h3 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #888;
    margin: 0 0 10px 0;
    font-weight: 600;
  }

  .backlinks ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .backlinks li {
    margin: 0;
  }

  .row {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid #2d4a5a;
    border-radius: 14px;
    background: transparent;
    transition: background 0.15s, border-color 0.15s;
  }

  li.expanded .row {
    background: #1a2a33;
    border-color: #6dd6ff;
  }

  .chevron {
    background: transparent;
    border: none;
    color: #6dd6ff;
    cursor: pointer;
    padding: 4px 6px 4px 10px;
    font-family: inherit;
    font-size: 11px;
    line-height: 1;
    border-radius: 14px 0 0 14px;
  }

  .chevron:hover {
    background: rgba(109, 214, 255, 0.12);
    color: #fff;
  }

  .chip {
    background: transparent;
    border: none;
    color: #6dd6ff;
    padding: 4px 12px 4px 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    border-radius: 0 14px 14px 0;
    transition: background 0.15s, color 0.15s;
  }

  .chip:hover {
    background: #2d4a5a;
    color: #fff;
  }

  .snippet-box {
    margin-top: 6px;
    margin-left: 22px;
    padding: 8px 12px;
    background: #1a1a1a;
    border-left: 2px solid #6dd6ff;
    border-radius: 0 4px 4px 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .snippet {
    margin: 0;
    color: #ccc;
    font-size: 12px;
    line-height: 1.5;
  }

  .snippet.no-match {
    color: #888;
    font-style: italic;
  }

  .placeholder {
    color: #666;
    font-size: 14px;
    letter-spacing: 0.2em;
  }

  .open-link {
    align-self: flex-start;
    background: transparent;
    border: none;
    color: #6dd6ff;
    font-family: inherit;
    font-size: 11px;
    padding: 2px 0;
    cursor: pointer;
  }

  .open-link:hover {
    color: #fff;
    text-decoration: underline;
  }
</style>
