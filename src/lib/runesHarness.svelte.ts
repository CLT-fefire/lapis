/**
 * `dom` 테스트 프로젝트의 **카나리아**.
 *
 * 룬은 `.svelte`/`.svelte.ts`에서만 살아 있고, vitest가 SSR로 컴파일하면 `$effect`가
 * **no-op이 된다** — 그러면 반응성 테스트가 "안 돌았는데 통과"한다. `vitest.config.ts`의
 * `conditions: ["browser"]`가 그걸 막는데, 그 설정이 사라져도 아무 신호가 없다.
 *
 * → 이 모듈이 신호를 만든다. `observeEffect`가 0회를 반환하면 하네스가 죽은 것이다.
 */
import { flushSync } from "svelte";

/** `$effect`가 실제로 몇 번 발화하는지 관찰한다. 값을 두 번 바꾸므로 정상이면 3회. */
export function observeEffect(): string[] {
  const seen: string[] = [];
  const stop = $effect.root(() => {
    let v = $state("a");
    $effect(() => {
      seen.push(v);
    });
    flushSync();
    v = "b";
    flushSync();
    v = "c";
    flushSync();
  });
  stop();
  return seen;
}

/**
 * 의존성을 **가드 뒤에서** 읽으면 어떻게 되는지. `+page.svelte`의 `const _html = parsed.html`
 * 관용구가 조건문 뒤로 밀렸을 때의 동작을 박제한다 — 리팩터가 이 함정에 빠지는지 보는 기준.
 */
export function observeGuardedRead(): { eager: string[]; guarded: string[] } {
  const eager: string[] = [];
  const guarded: string[] = [];
  const stop = $effect.root(() => {
    let html = $state("h1");
    let ready = $state(false);

    $effect(() => {
      eager.push(html); // 항상 읽는다 → 항상 의존한다
    });
    $effect(() => {
      if (!ready) return; // 가드가 먼저 → ready가 false인 동안 html에 의존하지 않는다
      guarded.push(html);
    });

    flushSync();
    html = "h2";
    flushSync(); // eager는 잡고, guarded는 **놓친다**
    ready = true;
    flushSync();
    html = "h3";
    flushSync();
  });
  stop();
  return { eager, guarded };
}
