<script lang="ts">
  import ModalShell from "$lib/ModalShell.svelte";

  /**
   * `ModalShell` 은 카드를 **snippet** 으로 받는다. snippet 은 `.svelte` 안에서만
   * 만들 수 있어서 `.ts` 테스트가 직접 못 띄운다 — 그래서 이 하네스가 있다.
   *
   * 안에 든 것은 실제 모달들과 같은 모양이다: 버튼 · 입력 · 버튼(초점 트랩 확인용).
   */
  let { onClose }: { onClose: () => void } = $props();
</script>

<ModalShell {onClose} label="테스트 모달">
  <div class="card" role="dialog" aria-modal="true" tabindex="-1">
    <button id="b1">하나</button>
    <input id="i1" />
    <button id="b2">둘</button>
  </div>
</ModalShell>
