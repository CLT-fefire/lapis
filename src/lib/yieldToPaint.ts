/**
 * 긴 작업의 청크 사이에서 **한 번 양보한다.**
 *
 * ## 🔴 rAF 를 기다리기만 하면 멈춘다
 *
 * `requestAnimationFrame` 은 창이 **가려지거나 최소화되면 한 번도 오지 않는다.**
 * 실측(dev 서버, 백그라운드 탭): `document.hidden === true` 인 동안 1.5s 에 0회.
 * 그 상태에서 인덱스 빌드가 첫 청크 경계에서 영원히 멈췄다 — 에러도 타임아웃도 로그도
 * 없이 "인덱스 만드는 중…" 오버레이만 남았다. **조용히 틀리는 것**의 전형이다.
 *
 * 그래서 rAF 를 **타이머와 경주시킨다.** 먼저 오는 쪽을 쓴다.
 *
 * ## 왜 rAF 를 아예 안 버리나
 *
 * 이 양보의 목적은 main thread 를 놓는 것만이 아니라 **스피너가 실제로 다시 그려지는 것**
 * 이다. `setTimeout(0)` 만 쓰면 매크로태스크는 갈리지만 paint 는 보장되지 않는다.
 * 보이는 창에서는 rAF 가 16ms 안에 오므로 아래 타임아웃(100ms)이 쓰일 일이 없다.
 *
 * 가려져 있으면 그릴 것이 없으니 paint 를 기다릴 이유도 없다 — 0ms 로 곧장 넘긴다.
 * 가시성은 도중에 바뀔 수 있으므로 `hidden` 판정만으로는 부족하고, 경주가 최종 안전망이다.
 *
 * ## ⚠️ 사본을 만들지 않는다
 *
 * 이 헬퍼는 `linkIndex` · `relations` · `stores/vault` 세 곳에 복제돼 있었고 결함도 세
 * 벌이었다. `yieldToPaint.test.ts` 가 사본을 금지한다.
 */

/** 보이는 창에서 rAF 가 오기까지 기다려 주는 상한. 60Hz 는 ~16ms, 30Hz 로 눌려도 ~33ms. */
const PAINT_TIMEOUT_MS = 100;

export function yieldToPaint(): Promise<void> {
  return new Promise<void>((resolve) => {
    const raf = globalThis.requestAnimationFrame;
    // 워커·노드에는 rAF 가 없다.
    if (typeof raf !== "function") {
      setTimeout(resolve, 0);
      return;
    }
    // 가려져 있으면 paint 를 기다릴 이유가 없다. `document` 가 없는 환경도 여기로.
    const doc = (globalThis as { document?: { hidden?: boolean } }).document;
    const hidden = doc?.hidden ?? true;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    raf.call(globalThis, finish);
    setTimeout(finish, hidden ? 0 : PAINT_TIMEOUT_MS);
  });
}
