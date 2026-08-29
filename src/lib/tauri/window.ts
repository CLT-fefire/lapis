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
