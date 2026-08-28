import { getCurrentWindow } from "@tauri-apps/api/window";
import { logWarn } from "$lib/stores/usage";

/**
 * 창별 localStorage 키 스코프.
 *
 * 창마다 다른 vault를 열 수 있게 되면서(2026-08-10) "이 창이 마지막으로 본 vault"처럼
 * **창에 매인 값**이 생겼다. localStorage는 origin 단위라 창끼리 그대로 공유되므로
 * 키에 창 라벨을 붙여 가른다.
 *
 * ⚠️ vault에 매인 값(탭 목록·핀·최근)은 여기 대상이 **아니다** — 이미 각자
 * vault별 맵이거나(`lapis.open-tabs`) 절대경로 키(`lapis.last-opened`)이거나
 * 표시 측에서 필터한다(`pinned`·`recent`). 실제로 창별이 필요한 건 vault 경로뿐이다.
 */

/** `main` 창의 라벨. 이 창만 **접미사 없는** 기존 키를 그대로 쓴다. */
const MAIN_LABEL = "main";

/**
 * 현재 창 라벨. Tauri 밖(vitest·브라우저 미리보기)에서는 `main`으로 떨어진다 —
 * 그래야 테스트가 기존 키를 그대로 보고, 미리보기에서도 동작한다.
 *
 * ⚠️ **캐시하지 않는다.** 예전엔 첫 호출 결과를 모듈 변수에 담았는데, `vault.ts`가
 * 모듈 로드 시점에 `scopedKey()`를 부르기 때문에 그 순간 Tauri 내부 객체가 아직
 * 없으면 `main`이 **영구히** 박혀버린다 — 보조 창이 main의 키를 읽어 남의 vault를
 * 그대로 여는 증상이 된다. 라벨 조회는 프로퍼티 읽기 한 번이라 캐시할 가치가 없다.
 */
export function windowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch (e) {
    // Tauri 밖(vitest·브라우저 미리보기)이면 내부 객체 자체가 없다 — 정상 fallback.
    // 반대로 Tauri **안**인데 못 읽었다면 예상 밖이다. 조용히 main으로 떨어지면
    // 보조 창이 main의 키를 읽어 남의 vault를 열게 되므로 흔적을 남긴다.
    const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (inTauri) {
      logWarn("windowScope", "windowLabel: Tauri 내부에서 라벨 조회 실패 — main으로 대체", e);
    }
    return MAIN_LABEL;
  }
}

/**
 * 창별 키. `main`은 접미사를 붙이지 않는다 — **기존 사용자의 저장값을 그대로 잇기**
 * 위해서다. 여기서 `main`도 접미사를 받게 하면 모든 기존 창이 vault를 잊는다.
 */
export function scopedKey(base: string): string {
  const label = windowLabel();
  return label === MAIN_LABEL ? base : `${base}.${label}`;
}

/**
 * 죽은 창의 키를 지운다. Tauri는 재시작 때 config의 `main`만 만들기 때문에,
 * 창을 열고 닫는 동안 쌓인 `<base>.wN` 키는 아무도 회수하지 않는다.
 *
 * `main` 창이 시동 시 1회 호출한다 — 그 시점에 살아 있는 창은 자기 자신뿐이다.
 */
export function pruneOrphanScopedKeys(base: string): void {
  if (typeof localStorage === "undefined") return;
  if (windowLabel() !== MAIN_LABEL) return;
  const prefix = `${base}.`;
  const doomed: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) doomed.push(k);
  }
  for (const k of doomed) localStorage.removeItem(k);
}
