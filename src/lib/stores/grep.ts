import { writable, get } from "svelte/store";
import { grepVault, type GrepResult } from "$lib/tauri/grep";
import { vaultPath } from "$lib/stores/vault";

/**
 * vault 전체 검색의 **상태 절반**. 판정은 Rust에 있고 여기는 store와 호출만 만진다.
 *
 * ## ⚠️ 타이핑 중에 돌리지 않는다
 *
 * 팔레트(`⌘⇧F`)는 디바운스를 걸고 키 입력마다 도는 경로다. 이쪽은 19,000 파일 · 52 MB를
 * 훑으므로 같은 방식을 쓸 수 없다. **Enter로 명시 실행**한다.
 *
 * 그래서 팔레트에 모드를 얹지 않고 별도 화면으로 뒀다. 계측으로 정교하게 맞춰진 팔레트
 * 경로(디바운스·점진 필터·스니펫 지연)에 성격이 다른 실행을 끼워 넣으면 그 조정이 깨진다.
 */

export const grepOpen = writable<boolean>(false);
export const grepPattern = writable<string>("");
export const grepRegex = writable<boolean>(false);
export const grepCase = writable<boolean>(false);
export const grepWholeWord = writable<boolean>(false);

export const grepRunning = writable<boolean>(false);
export const grepResult = writable<GrepResult | null>(null);
/** Rust가 돌려준 실패 메시지 — 잘못된 정규식이 대부분이다. */
export const grepError = writable<string | null>(null);

export function openGrep(): void {
  grepOpen.set(true);
}

export function closeGrep(): void {
  grepOpen.set(false);
}

/**
 * 검색 실행.
 *
 * ⚠️ 이전 결과를 **즉시 지우지 않는다.** 새 결과가 올 때까지 남겨두면 "검색 중"에도
 * 직전 결과를 계속 볼 수 있다. 실패했을 때 화면이 빈 채로 남는 것도 막는다.
 */
export async function runGrep(): Promise<void> {
  const pattern = get(grepPattern);
  const vault = get(vaultPath);
  if (!pattern || !vault) return;

  grepRunning.set(true);
  grepError.set(null);
  try {
    const r = await grepVault(vault, pattern, {
      regex: get(grepRegex),
      caseSensitive: get(grepCase),
      wholeWord: get(grepWholeWord),
    });
    grepResult.set(r);
  } catch (e) {
    grepError.set(e instanceof Error ? e.message : String(e));
    grepResult.set(null);
  } finally {
    grepRunning.set(false);
  }
}
