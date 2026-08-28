import { writable, get } from "svelte/store";
import { grepVault, type GrepResult } from "$lib/tauri/grep";
import { vaultPath, reloadNotes } from "$lib/stores/vault";
import { readNote } from "$lib/tauri/notes";
import { backupAndWrite } from "$lib/stores/vault";
import { describeFailure } from "$lib/safeWrite";
import {
  computeReplacePreview,
  ReplacePatternError,
  type ReplacePreview,
} from "$lib/replacePlan";

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
import { logWarn } from "$lib/stores/usage";
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

// ─── 찾아 바꾸기 ───────────────────────────────────────────────────────────

export const grepReplacement = writable<string>("");
export const replacePreview = writable<ReplacePreview | null>(null);
export const replaceBusy = writable<boolean>(false);
export const replaceError = writable<string | null>(null);
/**
 * grep이 찾은 파일 중 **치환 엔진은 매치를 못 찾은** 파일 수.
 *
 * ⚠️ 0이 아니면 두 엔진이 갈렸다는 신호다 — 아래 주석 참조.
 */
export const replaceEngineSkew = writable<number>(0);

export function resetReplace(): void {
  grepReplacement.set("");
  replacePreview.set(null);
  replaceError.set(null);
  replaceEngineSkew.set(0);
}

/**
 * 치환 미리보기 — **grep이 찾은 파일만** 읽는다.
 *
 * ## ⚠️ 두 엔진이 다르다
 *
 * 찾기는 Rust `regex`(`grep_vault`), 바꾸기는 JS `RegExp`다. Rust 쪽에 역참조·lookaround가
 * 없고 유니코드 경계 처리도 완전히 같지 않아 **매치 지점이 다를 수 있다**
 * (`tauri/grep.ts` 주석에 이미 적혀 있다).
 *
 * 그래서 두 가지를 지킨다:
 *
 * 1. **건수는 치환 엔진이 낸 것을 보여준다.** grep의 숫자를 그대로 쓰면 "보여준 것과
 *    바꾼 것이 다른" 상태가 조용히 생긴다.
 * 2. **grep이 안 찾은 파일은 건드리지 않는다.** 그래서 **놓칠 수는 있어도 사용자가 못 본
 *    파일을 쓰지는 않는다** — 놓침은 되돌릴 수 있고, 잘못된 쓰기는 아니다.
 *
 * 갈림이 실제로 있으면 `replaceEngineSkew`로 알린다. vault 전체를 대상으로 하고 싶으면
 * CLI(`lapis replace`)를 쓴다 — 거기는 grep을 거치지 않는다.
 */
export async function computeReplace(): Promise<void> {
  const result = get(grepResult);
  const pattern = get(grepPattern);
  const replacement = get(grepReplacement);
  if (!result || result.hits.length === 0 || !pattern) return;

  replaceBusy.set(true);
  replaceError.set(null);
  try {
    const paths = [...new Set(result.hits.map((h) => h.path))];
    const notes = new Map<string, string>();
    await Promise.all(
      paths.map(async (p) => {
        try {
          notes.set(p, await readNote(p));
        } catch (e) {
          // 한 파일을 못 읽었다고 전체를 세우지 않는다. 그 노트만 대상에서 빠진다.
          logWarn("stores/grep", `[replace] readNote 실패 ${p}:`, e);
        }
      }),
    );
    const preview = computeReplacePreview(notes, pattern, replacement, {
      regex: get(grepRegex),
      caseSensitive: get(grepCase),
      wholeWord: get(grepWholeWord),
    });
    replacePreview.set(preview);
    replaceEngineSkew.set(Math.max(0, notes.size - preview.items.length));
  } catch (e) {
    replaceError.set(
      e instanceof ReplacePatternError ? e.message : e instanceof Error ? e.message : String(e),
    );
    replacePreview.set(null);
  } finally {
    replaceBusy.set(false);
  }
}

/**
 * 적용 — 태그 이름 바꾸기와 **같은 트랜잭션**(백업 → 순차 쓰기 → 실패 시 롤백 → prune).
 *
 * ⚠️ **실패하면 화면을 닫지 않는다.** 예전에 결과를 안 보고 닫아서, 백업이 실패해
 * 아무것도 안 썼는데 사용자에게는 성공으로 보인 일이 있었다(#212). 되돌릴 수 없는
 * 쓰기에서 그건 가장 나쁜 실패다 — 됐다고 믿게 만든다.
 */
export async function applyReplace(): Promise<void> {
  const vault = get(vaultPath);
  const preview = get(replacePreview);
  if (!vault || !preview || preview.items.length === 0) return;

  replaceBusy.set(true);
  replaceError.set(null);
  try {
    const outcome = await backupAndWrite(vault, preview);
    if (!outcome.ok) {
      replaceError.set(describeFailure(outcome));
      return;
    }
    resetReplace();
    closeGrep();
    // 쓰기 뒤에 인덱스를 다시 만든다. 안 하면 검색이 옛 본문을 계속 낸다.
    await reloadNotes();
  } catch (e) {
    replaceError.set(e instanceof Error ? e.message : String(e));
  } finally {
    replaceBusy.set(false);
  }
}
