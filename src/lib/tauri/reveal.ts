import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { logWarn } from "$lib/stores/usage";

/**
 * Finder에서 대상을 **선택된 상태로** 연다.
 *
 * - 파일 → 부모 폴더가 열리고 그 파일이 선택된다.
 * - 폴더 → **상위** 폴더가 열리고 그 폴더가 선택된다(폴더 안으로 들어가지 않는다).
 *   macOS Finder "Finder에 표시"와 같은 동작이라 의도된 것이다.
 *
 * 권한: `src-tauri/capabilities/default.json` 의 `opener:allow-reveal-item-in-dir`.
 * 누락 시 Tauri는 **조용히 reject** 하므로 아래 catch가 유일한 단서가 된다.
 *
 * 실패해도 throw하지 않는다 — 파일이 그새 지워졌거나 외부 볼륨이 빠진 경우처럼
 * 사용자가 손쓸 수 없는 사유가 대부분이고, 부수적 액션이라 흐름을 끊을 이유가 없다.
 */
export async function revealInFinder(path: string): Promise<void> {
  if (!path) return;
  try {
    await revealItemInDir(path);
  } catch (e) {
    logWarn("tauri/reveal", "[reveal] Finder에서 보기 실패", path, e);
  }
}
