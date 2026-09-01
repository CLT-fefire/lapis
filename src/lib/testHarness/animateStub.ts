/**
 * `happy-dom` 에는 **Web Animations API 가 없다.** Svelte 의 `transition:` 이
 * `element.animate` 를 부르므로, 모달처럼 트랜지션을 쓰는 컴포넌트를 dom 테스트에서
 * 닫으면 `TypeError: element.animate is not a function` 으로 터진다.
 *
 * ⚠️ **전역 setup 에 두지 않는다.** 이 저장소가 `resolve.conditions: ["browser"]` 를
 * 전역에 안 두는 것과 같은 이유다 — 어느 테스트가 무엇에 기대는지가 안 보이게 된다.
 * 필요한 파일이 명시적으로 부른다.
 *
 * ⚠️ **끝났다고 알려 줘야 한다.** 객체만 돌려주면 아웃트로가 영영 안 끝나고 닫힌 모달의
 * 노드가 DOM 에 남는다. 그러면 "모달이 안 닫힌다"는 **틀린 결론**이 나온다 — 이 저장소가
 * 프리뷰 계측에서 이미 한 번 헛짚은 자리다(숨겨진 탭에서 트랜지션이 안 끝나던 것).
 */
export function installAnimateStub(): void {
  if ((Element.prototype as Partial<Element>).animate) return;

  (Element.prototype as unknown as { animate: () => unknown }).animate = () => {
    let onfinish: (() => void) | null = null;
    const a = {
      cancel() {},
      finish() {
        onfinish?.();
      },
      currentTime: 0,
      playState: "finished",
      finished: Promise.resolve(),
      addEventListener(_: string, cb: () => void) {
        setTimeout(cb, 0);
      },
      removeEventListener() {},
    };
    Object.defineProperty(a, "onfinish", {
      get: () => onfinish,
      set: (fn: (() => void) | null) => {
        onfinish = fn;
        if (fn) setTimeout(fn, 0);
      },
    });
    return a;
  };
}

/** 마이크로태스크와 타이머가 도는 틈. 트랜지션 아웃트로가 끝나야 노드가 사라진다. */
export const flushFrames = async (n = 4): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
