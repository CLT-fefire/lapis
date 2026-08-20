/**
 * `dom` 프로젝트가 살아 있는지 확인하는 카나리아. 실패하면 `vitest.config.ts`의
 * `dom` 프로젝트 설정(`conditions: ["browser"]` · svelte 플러그인 · happy-dom)을 본다.
 */
import { describe, expect, it } from "vitest";
import { observeEffect, observeGuardedRead } from "./runesHarness.svelte";

describe("룬 하네스 카나리아", () => {
  // ⚠️ 이 테스트가 없으면 `conditions: ["browser"]`가 사라져도 **아무 신호가 없다**.
  // SSR 컴파일에서 `$effect`는 no-op이고, 반응성 테스트는 전부 조용히 통과한다.
  it("$effect가 실제로 발화한다 — 0회면 하네스가 죽은 것이다", () => {
    expect(observeEffect()).toEqual(["a", "b", "c"]);
  });

  it("document가 있다", () => {
    const el = document.createElement("div");
    el.innerHTML = "<span>x</span>";
    expect(el.querySelectorAll("span").length).toBe(1);
  });
});

describe("의존성 등록 — 가드 위치가 발화를 바꾼다", () => {
  // `+page.svelte`의 `const _html = parsed.html` 관용구가 위험한 이유를 박제한다.
  // 리팩터할 때 이 차이를 잊으면 "가끔 갱신이 안 되는" 버그가 된다.
  it("가드 뒤에서 읽으면 그 전의 변경을 놓친다", () => {
    const { eager, guarded } = observeGuardedRead();
    expect(eager).toEqual(["h1", "h2", "h3"]);
    // h1(초기)과 h2(가드가 닫혀 있던 동안의 변경)를 못 봤다.
    expect(guarded).toEqual(["h2", "h3"]);
    expect(guarded.length).toBeLessThan(eager.length);
  });
});
