import { invoke } from "$lib/tauri/invoke";

/**
 * 새 창을 띄우고 그 창의 라벨을 반환한다.
 *
 * 새 창은 **vault가 비어 있는 상태**로 시작한다 — 창별 `lapis.last-vault-path.<label>`
 * 키가 아직 없기 때문이다. 그래서 별도 다이얼로그를 띄우지 않아도 기존 "Vault 열기…"
 * 화면이 그대로 나온다. 거기서 다른 vault를 고르면 그 창만 바뀐다.
 */
export function newWindow(): Promise<string> {
  return invoke<string>("new_window");
}

/**
 * 창이 닫히기 **전에** 할 일을 등록한다. 반환값은 해지 함수.
 *
 * ## 🔴 `beforeunload` 로는 못 하는 일이다
 *
 * `beforeunload` 는 비동기를 기다려 주지 않는다. 사용 로그 버퍼는 메모리에만 있고 flush 가
 * 비동기라, 거기서 남기면 **에러 없이 통째로 사라진다.** Tauri 의 `onCloseRequested` 는
 * 핸들러가 끝날 때까지 닫기를 미룬다.
 *
 * ⚠️ **핸들러를 오래 잡지 않는다.** 여기서 기다리는 동안 창이 안 닫힌다 — 사용자에게는
 * 앱이 멈춘 것으로 보인다.
 *
 * ⚠️ Tauri 밖(브라우저 프리뷰)에서는 없는 API 다. 호출부가 실패를 삼키고 계속 간다.
 */
export async function onWindowClose(fn: () => void | Promise<void>): Promise<() => void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return await getCurrentWindow().onCloseRequested(async () => {
    await fn();
  });
}
