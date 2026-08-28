import { invoke } from "$lib/tauri/invoke";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * `lapis open <노트>` 의 프론트 쪽 절반.
 *
 * ## 왜 Rust가 창을 고르지 않고 창이 스스로 가져가나
 *
 * Rust는 **어느 창이 어느 vault를 열었는지 모른다** — 그건 창별 localStorage에 있다.
 * 그래서 묻지 않고 꺼내가게 한다: Rust는 열 것을 담아두고 모두에게 알리기만 하고,
 * 각 창이 **자기 vault를 인자로** 꺼내기를 시도한다. vault가 맞는 창만 받는다.
 *
 * ⚠️ 꺼내기는 Rust 쪽에서 **원자적**이다. 안 그러면 창 둘이 같은 노트를 각자 열고
 * 둘 다 자기가 포커스를 가져간다.
 *
 * 근거 전문은 `src-tauri/src/cliopen.rs` 모듈 주석에 있다.
 */

export interface PendingOpen {
  path: string;
  vault: string;
}

/**
 * "내 것이면 달라"고 묻는다.
 *
 * @param vault 이 창이 연 vault. `null`이면 **무엇이든** 받는다 — 방금 이걸 위해
 *              만들어진 새 창만 그렇게 묻는다.
 */
export function takePendingOpen(vault: string | null): Promise<PendingOpen | null> {
  return invoke<PendingOpen | null>("take_pending_open", { vault });
}

/**
 * `cli:open` 구독.
 *
 * ⚠️ `watcher.ts`와 달리 **`target`을 주지 않는다.** 저기는 창마다 다른 vault의 변경을
 * 걸러야 해서 라벨로 좁히지만, 여기는 반대로 **모든 창이 들어야** 한다 — 누가 받을지는
 * 각 창이 자기 vault를 보고 정하기 때문이다. Rust도 `emit_to`가 아니라 `emit`으로 보낸다.
 */
export function onCliOpen(handler: () => void | Promise<void>): Promise<UnlistenFn> {
  return listen("cli:open", () => {
    void handler();
  });
}
