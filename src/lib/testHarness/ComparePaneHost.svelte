<script lang="ts">
  import ComparePane from "$lib/ComparePane.svelte";

  /**
   * 테스트 전용 껍데기 — `ComparePane` 의 `path` 를 **바꿔 가며** 볼 수 있게 한다.
   *
   * ## ⚠️ 왜 필요한가
   *
   * 프롭이 바뀌는 상황은 룬(`$state`)이 있어야 만들 수 있는데, 룬은 `.svelte` 안에서만
   * 컴파일된다. `.ts` 테스트에서 `$state` 를 쓰면 `rune_outside_svelte` 로 죽는다.
   *
   * 🔴 **다시 띄우는 것으로는 대신할 수 없다.** 새로 띄우면 애초에 옛 내용이 없어서
   * "경로가 바뀌는 동안 옛 노트를 보여주나"를 아예 못 묻는다. 같은 인스턴스의 프롭을
   * 바꿔야 그 결함이 드러난다.
   *
   * ⚠️ `mount()` 가 돌려주는 객체에 프롭을 **대입해도 안 먹는다**(실측). 그래서 바꾸는
   * 길을 **함수로 내보낸다** — `mount` 는 `<script>` 의 `export function` 을 인스턴스에 올린다.
   *
   * ⚠️ 프로덕션에 안 들어간다 — 테스트만 import 한다. 번들러가 걷어낸다.
   */
  let path = $state("");

  /**
   * ⚠️ 첫 경로도 **함수로** 받는다.
   *
   * 프롭으로 받아 `$state(initial)` 로 넣으면 svelte-check 가 운다 — 그 참조는 초기값만
   * 잡으므로 프롭이 바뀌어도 안 따라온다는 경고다. 여기서는 일부러 초기값만 쓰는 것이
   * 맞지만, **경고를 남겨 두면 다음 사람이 진짜 경고와 구별을 못 한다.**
   */
  export function setPath(next: string): void {
    path = next;
  }
</script>

<ComparePane {path} />
