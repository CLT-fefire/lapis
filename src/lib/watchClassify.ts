import { hasNoteExt } from "$lib/notePath";
import type { VaultChange } from "$lib/tauri/watcher";

/**
 * 워처 이벤트 하나를 어떻게 다룰 것인가 — **노트인가 디렉터리인가.**
 *
 * ## 🔴 왜 생겼나 (2026-08-30 실사용 로그 · 43회)
 *
 * `[reindex] scan/update 실패` 가 **43회** 쌓여 있었고 경로가 전부 디렉터리였다
 * (12개 디렉터리에 흩어져서). 프런트가 디렉터리 경로를 **노트로 취급**했다:
 *
 * - `scanLinkSingle(디렉터리)` → 실패 → 경고 한 줄
 * - `touchMtime(디렉터리)` → 시간축 지도가 더러워진다(팔레트의 "최근 변경")
 * - `markChangedFromWatcher(디렉터리)` → 있지도 않은 노트를 "밖에서 바뀜"으로 표시
 *
 * ⚠️ **경계에서 계약이 어긋났다.** 생산자(`watcher.rs`)는 *"디렉토리 자체 이벤트는 통과
 * (rename 등 인지 위해)"* 라고 **일부러** 흘려보내는데, 소비자는 "노트가 바뀌었다"로 들었다.
 *
 * ⚠️ 조용하다. 실패해도 루프가 계속 돌아 **다른 노트는 정상 반영된다.** 그래서 경고만
 * 쌓였고, 그 경고는 `lapis usage` 사람용 화면이 "경고 50" 이라는 맨숫자로만 냈다.
 *
 * ## 무엇으로 가르나
 *
 * **확장자만 본다.** 이벤트가 도착할 때 그 경로는 이미 없을 수도 있어서(삭제·이름 바꾸기)
 * 디스크에 물어볼 수가 없다. "노트 확장자가 아니면 디렉터리"로 읽는 근거는 생산자 계약이다 —
 * `is_relevant_path` 가 **파일은 `.md`/`.mmd` 만** 통과시킨다.
 *
 * ⚠️ 확장자 판정은 `notePath.ts` 하나가 주인이다(`check:arch` 가 사본을 막는다).
 */
export type WatchAction =
  /** 노트 하나가 바뀌었다 — 증분 재인덱싱으로 간다. */
  | "note"
  /**
   * 볼 것이 없다.
   *
   * 디렉터리 mtime 은 **안의 파일이 바뀔 때마다** 바뀌고, 그 파일 이벤트는 따로 온다.
   * ⚠️ 여기서 풀 리로드를 걸면 파일 하나 저장할 때마다 vault 전체를 다시 읽는다.
   */
  | "ignore"
  /**
   * 범위를 모른다 — 통째로 다시 읽는다.
   *
   * 폴더가 사라지거나 이름이 바뀌면 그 아래 노트가 전부 움직인 것인데 **개별 파일
   * 이벤트는 안 온다.** 증분으로는 못 따라간다.
   */
  | "reload";

/** 이 경로가 노트 파일인가. 확장자로만 본다 — 위 주석 참조. */
function isNotePath(path: string): boolean {
  const name = path.split(/[\\/]/).pop() ?? "";
  return hasNoteExt(name);
}

export function classifyChange(change: VaultChange): WatchAction {
  if (change.kind === "renamed") {
    // ⚠️ 한쪽만 디렉터리여도 범위를 모르는 것은 같다.
    return isNotePath(change.from) && isNotePath(change.to) ? "note" : "reload";
  }
  if (isNotePath(change.path)) return "note";
  // 디렉터리 — 사라졌거나 이름이 바뀐 것만 범위를 모른다.
  return change.kind === "removed" ? "reload" : "ignore";
}
