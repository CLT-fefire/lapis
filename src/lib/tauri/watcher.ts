import { invoke } from "$lib/tauri/invoke";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { windowLabel } from "$lib/windowScope";

export type VaultChange =
  | { kind: "created"; path: string }
  | { kind: "modified"; path: string; mtime_ms: number }
  | { kind: "removed"; path: string }
  | { kind: "renamed"; from: string; to: string };

export function watchVault(vaultPath: string): Promise<void> {
  return invoke<void>("watch_vault", { vaultPath });
}

export function unwatchVault(): Promise<void> {
  return invoke<void>("unwatch_vault");
}

/**
 * `vault:change` Tauri 이벤트 구독. unlisten 함수 반환.
 *
 * ⚠️ **`target`을 반드시 넘긴다.** 옵션 없이 `listen()`을 부르면 리스너가
 * `EventTarget::Any`로 등록되는데, Tauri의 매칭이
 * `*target == Any || filter(target)` 이라(`event/listener.rs`) **필터를 통째로
 * 건너뛴다** — Rust가 `emit_to(label)`로 아무리 좁혀 보내도 모든 창이 다 받는다.
 * 창마다 다른 vault를 여는 지금 구조에선 남의 vault 변경으로 재인덱싱하게 된다.
 *
 * 자기 창 라벨로 등록하면 `emit_to(AnyLabel{L})`의 필터가 라벨을 비교해 걸러준다.
 */
export function onVaultChange(
  handler: (change: VaultChange) => void | Promise<void>,
): Promise<UnlistenFn> {
  return listen<VaultChange>(
    "vault:change",
    (event) => {
      void handler(event.payload);
    },
    { target: { kind: "AnyLabel", label: windowLabel() } },
  );
}
