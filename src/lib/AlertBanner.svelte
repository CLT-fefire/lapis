<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { TriangleAlert, X } from "@lucide/svelte";
  import { alerts, dismissAlert } from "$lib/stores/alerts";

  /**
   * 사용자가 알아야 하는 실패를 띄운다.
   *
   * ## ⚠️ 왜 배너인가 — 토스트가 아니라
   *
   * 토스트는 **사라진다.** 여기 오는 것은 되돌릴 수 없는 쓰기의 실패라, 자리를 비운
   * 사이에 지나가 버리면 "이름은 바뀌었는데 인용은 안 바뀐" 상태를 영영 모른다.
   * 사용자가 **직접 닫아야** 사라진다.
   *
   * ⚠️ 자세한 내용은 접어 둔다. 예외 문자열이 첫 줄에 있으면 정작 무엇이 실패했는지가
   * 안 읽힌다.
   */
  let expanded = $state<Set<string>>(new Set());

  function toggle(key: string): void {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expanded = next;
  }
</script>

{#if $alerts.length > 0}
  <div class="alerts" role="alert" data-lapis="alerts">
    {#each $alerts as a (a.key)}
      <div class="alert">
        <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />
        <div class="body">
          <span class="msg">{a.message}</span>
          {#if a.detail}
            <button class="more" onclick={() => toggle(a.key)}>
              {expanded.has(a.key) ? m.alert_less() : m.alert_more()}
            </button>
            {#if expanded.has(a.key)}
              <pre class="detail">{a.detail}</pre>
            {/if}
          {/if}
        </div>
        <button
          class="close"
          aria-label={m.alert_dismiss()}
          title={m.alert_dismiss()}
          onclick={() => dismissAlert(a.key)}
        >
          <X size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .alerts {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: none;
  }

  /**
   * ⚠️ `--danger-bg-subtle` 위의 `--danger-text` 다. `--danger` 를 글자에 쓰면 대비가
   * 미달한다(v2.3.1 에서 열다섯 곳을 옮긴 이유).
   */
  .alert {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-4);
    background: var(--danger-bg-subtle);
    color: var(--danger-text);
    font-size: var(--fs-sm);
  }

  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .msg {
    overflow-wrap: anywhere;
  }

  .more {
    align-self: flex-start;
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    font: inherit;
    font-size: var(--fs-xs);
    text-decoration: underline;
    cursor: pointer;
  }

  .detail {
    margin: 2px 0 0;
    max-height: 8em;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    opacity: 0.9;
  }

  .close {
    flex: none;
    display: flex;
    align-items: center;
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    cursor: pointer;
    opacity: 0.7;
  }

  .close:hover {
    opacity: 1;
  }
</style>
