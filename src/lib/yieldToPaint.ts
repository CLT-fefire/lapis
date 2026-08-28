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
 * ## 양쪽 머신에서 같아야 한다
 *
 * **`document.hidden` 이 정확한지에 기대지 않는 것이 요점이다.** macOS 의 WKWebView 가 창
 * 가림을 Page Visibility 로 보고하는지 여부는 여기서 확인할 수 없고(Windows 에서 잰 결과를
 * macOS 근거로 쓰지 않는다), 확인할 필요도 없다 — `hidden` 은 타임아웃을 0ms 로 할지
 * 100ms 로 할지만 정하고, **어느 쪽이든 반드시 풀린다.**
 *
 * 최악(창은 가려졌는데 `hidden` 이 거짓이라 rAF 를 100ms 씩 기다리는 경우)의 상한도 작다.
 * 12,000 노트 vault 의 양보 횟수는 ~14회(`reloadNotesInner` 4 + `buildIndexChunked` 2 +
 * `buildRelationIndexChunked` 는 `yieldEvery=1500` 이라 8) → **약 1.4초.** 그 전에는
 * 무한이었다.
 *
 * ⚠️ `setTimeout` 이 백그라운드에서 throttle 되지 않는지 실측했다(6회 전부 0ms 대).
 * `MessageChannel` 로 바꿀 근거가 없어 안 바꿨다 — 근거 없는 복잡도를 넣지 않는다.
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
