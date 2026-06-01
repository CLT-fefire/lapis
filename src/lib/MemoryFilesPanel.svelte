<script lang="ts">
  import { jumpToWikilink } from "$lib/stores/vault";

  /**
   * 메모리 노트의 frontmatter `files_read` / `files_edited` 값을 받아서
   * basename 기반 wikilink로 표시. 클릭 → vault에서 매칭되는 노트로 점프 (linkIndex resolver).
   *
   * 입력은 raw string. claude-mem export 시 보통 JSON 배열 문자열 형태:
   *   `files_read: "[\"a.swift\", \"b.swift\"]"`
   *
   * 또는 단일 경로 또는 쉼표 구분일 수도 — 모두 best-effort 파싱.
   */
  interface Props {
    filesRead?: unknown;
    filesEdited?: unknown;
  }
  let { filesRead, filesEdited }: Props = $props();

  function parseList(raw: unknown): string[] {
    if (Array.isArray(raw)) {
      return raw.filter((x): x is string => typeof x === "string");
    }
    if (typeof raw !== "string") return [];
    const trimmed = raw.trim();
    if (!trimmed) return [];
    // JSON 배열 시도
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.filter((x): x is string => typeof x === "string");
        }
      } catch {
        // fall-through
      }
    }
    // 쉼표 구분
    if (trimmed.includes(",")) {
      return trimmed.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    }
    // 단일 경로 또는 단일 줄
    return [trimmed];
  }

  const readList = $derived(parseList(filesRead));
  const editedList = $derived(parseList(filesEdited));

  // basename 기반 wikilink (linkIndex resolver는 lowercase 기반)
  function basename(p: string): string {
    const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return idx === -1 ? p : p.slice(idx + 1);
  }

  async function go(path: string) {
    const stem = basename(path).replace(/\.[^.]+$/, "");
    await jumpToWikilink(stem);
  }

  let collapsed = $state(false);
  const hasAny = $derived(readList.length > 0 || editedList.length > 0);
</script>

{#if hasAny}
  <section class="mem-files">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="head" onclick={() => (collapsed = !collapsed)}>
      <span class="caret">{collapsed ? "▶" : "▼"}</span>
      <span class="title">이 메모리에서 만진 파일</span>
      <span class="meta">{readList.length + editedList.length}건</span>
    </div>
    {#if !collapsed}
      {#if editedList.length > 0}
        <div class="group">
          <span class="grp-label edited">edited</span>
          <span class="files">
            {#each editedList as f}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span class="chip" title={f} onclick={() => go(f)}>{basename(f)}</span>
            {/each}
          </span>
        </div>
      {/if}
      {#if readList.length > 0}
        <div class="group">
          <span class="grp-label read">read</span>
          <span class="files">
            {#each readList as f}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <span class="chip" title={f} onclick={() => go(f)}>{basename(f)}</span>
            {/each}
          </span>
        </div>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .mem-files {
    margin-top: 20px;
    border-top: 1px solid var(--border-subtle);
    padding-top: 14px;
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    cursor: pointer;
    user-select: none;
  }

  .caret {
    color: var(--text-muted);
    font-size: 10px;
    width: 12px;
  }

  .title {
    color: var(--violet);
    font-weight: 600;
    font-size: var(--fs-base);
  }

  .meta {
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }

  .group {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 0 4px 20px;
  }

  .grp-label {
    flex-shrink: 0;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 7px;
    height: fit-content;
    margin-top: 2px;
  }

  .grp-label.edited {
    background: var(--warning-bg-subtle);
    color: var(--warning);
    border: 1px solid var(--warning-border);
  }

  .grp-label.read {
    background: var(--violet-bg-subtle);
    color: var(--violet);
    border: 1px solid var(--violet-border);
  }

  .files {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .chip {
    font-size: var(--fs-xs);
    color: var(--accent);
    background: var(--accent-bg-subtle);
    border: 1px solid var(--accent-border);
    border-radius: var(--r-sm);
    padding: 1px 6px;
    cursor: pointer;
    font-family: var(--font-mono);
  }

  .chip:hover {
    background: var(--accent-bg-subtle);
    color: var(--accent-hover);
  }
</style>
