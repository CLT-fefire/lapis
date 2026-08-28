import { invoke as tauriInvoke } from "@tauri-apps/api/core";

/**
 * `invoke` 의 **단일 진입점**.
 *
 * ## ⚠️ 왜 한 겹을 더 두나
 *
 * Tauri 밖(브라우저 프리뷰)에서는 `invoke` 가 없어 vault 를 못 연다. 그래서 이 세션에서
 * **필터 패널 · 표 · 진단 모달을 한 번도 화면으로 못 봤고**, 칩 활성 표시가 빠진 채로 두
 * 릴리스가 나갔다(v3.1.0 · v3.3.0). `class:active` 는 제대로 걸려 있었고 **CSS 규칙만
 * 없었다** — 순수 함수 테스트도 배선 가드도 못 잡는 종류다.
 *
 * dev 서버에서만 가짜 백엔드로 흘려 화면을 실제로 볼 수 있게 한다.
 *
 * ## ⚠️ 프로덕션에는 안 들어간다
 *
 * `import.meta.env.DEV` 는 빌드 시점에 `false` 로 치환되고, 번들러가 그 분기를 통째로
 * 걷어낸다 — 가짜 백엔드 모듈은 프로덕션 번들에 **존재하지 않는다.**
 * `devBackend.test.ts` 가 그것을 못 박는다.
 *
 * ## ⚠️ Tauri 안에서는 절대 안 쓴다
 *
 * `__TAURI_INTERNALS__` 가 있으면 진짜 `invoke` 다. dev 빌드(`npm run tauri dev`)도
 * Tauri 안이므로 여기 안 걸린다 — 가짜가 실물을 가리는 일은 없다.
 */

/** Tauri 런타임 안인가. */
export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 지금 가짜 백엔드로 도는가.
 *
 * 화면이 이 값을 읽어 **픽스처라는 표시**를 그린다. 표시가 없으면 프리뷰에서 본 것을
 * 실물로 착각하게 되고, 그게 이 도구가 만들 수 있는 최악의 실수다.
 *
 * ## 🔴 테스트에서는 절대 안 쓴다
 *
 * vitest 도 `DEV` 이고 Tauri 밖이다. 이 조건이 없으면 `invoke` 를 타는 모든 테스트가
 * **목 대신 픽스처를 문다** — 그리고 픽스처는 그럴듯한 값을 주므로 단언이 조용히
 * 통과한다. 실제로 걸렸다: `@tauri-apps/api/core` 를 목킹한 테스트가 목을 못 타고
 * `usageDropped` 가 0 으로 나왔다. 관찰 장치가 관찰을 안 하고 초록이 되는 길이다.
 */
export function usingFakeBackend(): boolean {
  return import.meta.env.DEV && import.meta.env.MODE !== "test" && !inTauri();
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (usingFakeBackend()) {
    const { fakeInvoke } = await import("$lib/dev/fakeBackend");
    return (await fakeInvoke(cmd, args ?? {})) as T;
  }
  return tauriInvoke<T>(cmd, args);
}
