import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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

/** `vault:change` Tauri 이벤트 구독. unlisten 함수 반환. */
export function onVaultChange(
  handler: (change: VaultChange) => void | Promise<void>,
): Promise<UnlistenFn> {
  return listen<VaultChange>("vault:change", (event) => {
    void handler(event.payload);
  });
}
