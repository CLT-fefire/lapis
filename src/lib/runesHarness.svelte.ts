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

/**
 * 의존성을 **함수 안에서** 읽어도 등록되는가. `+page.svelte`가 `const _html = parsed.html`
 * 관용구를 `trackPreviewHtml()` 호출로 바꾸면서 기대는 성질이다 — 추적은 어휘 위치가 아니라
 * **실행 시점의 동적 스코프**를 따른다는 것.
 *
 * ⚠️ 이게 깨지면 프리뷰 후처리(위키링크 클래스·mermaid·이미지 경로·검색 하이라이트)가
 * **노트를 넘겨도 안 도는** 버그가 된다. 에러는 안 난다.
 */
export function observeHelperRead(): { direct: string[]; viaHelper: string[] } {
  const direct: string[] = [];
  const viaHelper: string[] = [];
  const stop = $effect.root(() => {
    let html = $state("h1");
    // effect 본문이 아니라 **여기서** 읽는다. 호출은 effect 안에서 일어난다.
    const track = () => {
      void html;
    };

    $effect(() => {
      direct.push(html);
    });
    $effect(() => {
      // ⚠️ 본문에서 `html`을 **직접 읽지 않는다.** 한 번이라도 직접 읽으면 그 읽기가
      // 의존성을 걸어버려, `track()`이 아무것도 안 읽어도 테스트가 통과한다(실제로 그렇게
      // 한 번 헛돌았다 — 카나리아로 잡았다). 등록 경로를 `track()` 하나로 묶는다.
      track();
      viaHelper.push("fired");
    });

    flushSync();
    html = "h2";
    flushSync();
    html = "h3";
    flushSync();
  });
  stop();
  return { direct, viaHelper };
}
