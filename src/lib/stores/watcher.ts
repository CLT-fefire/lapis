import { writable, get } from "svelte/store";
import { watchVault, unwatchVault, onVaultChange, type VaultChange } from "$lib/tauri/watcher";
import { readNote } from "$lib/tauri/notes";
import { invalidateCacheBySource } from "$lib/backlinks";
import { markChangedFromWatcher } from "./unread";
import { touchMtime, dropMtime } from "./mtimes";
import { scheduleAutoCommit } from "./git";
import {
  vaultPath,
  currentNotePath,
  closeTab,
  reindexIncremental,
  requestFullReload,
} from "./vault";
import { classifyChange } from "$lib/watchClassify";

export type WatcherStatus = "idle" | "watching" | "error";
import { logError, logWarn } from "$lib/stores/usage";
import { pushAlert } from "$lib/stores/alerts";
import { m } from "$lib/paraglide/messages.js";

export const watcherStatus = writable<WatcherStatus>("idle");
export const lastWatchError = writable<string | null>(null);

/**
 * 외부 변경 충돌 상태 — 현재 노트가 dirty인데 외부에서도 변경된 케이스.
 * editor.ts와 협력해서 사용자에게 다이얼로그 노출.
 */
export interface ExternalConflict {
  path: string;
  externalMtimeMs: number;
}
export const externalConflict = writable<ExternalConflict | null>(null);

let unlisten: (() => void) | null = null;

export async function startWatching(): Promise<void> {
  const path = get(vaultPath);
  if (!path) return;

  // 이전 리스너 정리
  if (unlisten) {
    unlisten();
    unlisten = null;
  }

  lastWatchError.set(null);
  try {
    await watchVault(path);
    const u = await onVaultChange(handleChange);
    unlisten = u;
    watcherStatus.set("watching");
  } catch (e) {
    logError("stores/watcher", "[watcher] start failed:", e);
    lastWatchError.set(e instanceof Error ? e.message : String(e));
    watcherStatus.set("error");
  }
}

export async function stopWatching(): Promise<void> {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  try {
    await unwatchVault();
  } catch (e) {
    logWarn("stores/watcher", "[watcher] stop failed:", e);
  }
  watcherStatus.set("idle");
}

/**
 * 이벤트 → **증분 재인덱싱**. 변경/삭제 경로를 모았다가(디바운스 500ms) `reindexIncremental`로
 * 바뀐 노트만 반영(vault 전체 재읽기 없음 → 인덱스 빌드 스피너 freeze 제거). 큰 burst /
 * 인덱스 미준비 / shardCount 임계 변동은 reindexIncremental이 풀 빌드로 fallback.
 */
const pendingChanged = new Set<string>();
const pendingRemoved = new Set<string>();
/** 디렉터리가 사라지거나 이름이 바뀌었다 — 증분으로는 못 따라간다. */
let pendingFullReload = false;

async function handleChange(change: VaultChange): Promise<void> {
  const root = get(vaultPath);
  if (!root) return;

  // 🔴 **디렉터리 이벤트를 노트로 취급하지 않는다.** 생산자(`watcher.rs`)는 디렉터리
  //    이벤트를 일부러 통과시키는데, 예전엔 여기서 그대로 노트 경로로 흘려보냈다 —
  //    실사용 로그에 `[reindex] scan/update 실패` 가 **43회** 쌓여 있었고, 시간축 지도와
  //    "밖에서 바뀜" 표시까지 디렉터리로 더러워졌다. 근거는 `watchClassify.ts`.
  const action = classifyChange(change);
  if (action === "ignore") return;
  if (action === "reload") {
    // 범위를 모르니 통째로 다시 읽는다. **같은 디바운스**를 탄다 — 폴더 하나를 지우면
    // 이벤트가 여러 개 오는데 그때마다 vault 를 다시 읽으면 안 된다.
    pendingFullReload = true;
    scheduleIncrementalReindex();
    return;
  }

  // 이번 이벤트로 바뀐 경로 — git 자동커밋에 targeted add로 넘긴다.
  const touched: string[] = [];

  switch (change.kind) {
    case "modified":
    case "created":
      pendingRemoved.delete(change.path);
      pendingChanged.add(change.path);
      touched.push(change.path);
      // 시간축 지도도 같이 고친다. 안 고치면 팔레트의 '최근 변경'이 낡은다.
      touchMtime(change.path, "mtime_ms" in change ? change.mtime_ms : Date.now());
      // 본문이 바뀌었으니 이 path를 source로 하는 백링크 snippet 캐시는 stale.
      invalidateCacheBySource(change.path);
      // 현재 열린 노트가 영향 받으면 외부변경 충돌/리로드 즉시 처리.
      if (get(currentNotePath) === change.path) {
        const mtime = "mtime_ms" in change ? change.mtime_ms : Date.now();
        await reconcileCurrentNote(change.path, mtime);
      } else {
        // 지금 보고 있지 않은 노트만 "안 본 사이 바뀜"으로 표시한다 — 읽는 중에
        // 볼드가 되면 혼란스럽고, 열린 노트는 위 reconcile이 따로 처리한다.
        const mtime = "mtime_ms" in change ? change.mtime_ms : Date.now();
        markChangedFromWatcher(change.path, mtime);
      }
      break;
    case "removed":
      pendingChanged.delete(change.path);
      pendingRemoved.add(change.path);
      touched.push(change.path);
      invalidateCacheBySource(change.path);
      // 남겨두면 없는 노트가 '최근 변경'에 뜬다.
      dropMtime(change.path);
      void closeTab(change.path); // 열려 있었다면 탭 제거
      break;
    case "renamed":
      pendingChanged.delete(change.from);
      pendingRemoved.add(change.from);
      pendingRemoved.delete(change.to);
      pendingChanged.add(change.to);
      touched.push(change.from, change.to);
      invalidateCacheBySource(change.from);
      invalidateCacheBySource(change.to);
      void closeTab(change.from);
      break;
  }

  scheduleIncrementalReindex();

  // git 버전관리 켜진 vault면 변경 정착 후 자동 커밋 예약(내부에서 repo 여부 확인).
  scheduleAutoCommit(root, touched);
}

/**
 * 충돌 감지 — editor.ts의 isDirty와 협력.
 * dirty가 아니면 자동으로 fresh content로 markSaved.
 * dirty면 externalConflict store에 등록 → UI 다이얼로그.
 */
async function reconcileCurrentNote(path: string, mtimeMs: number): Promise<void> {
  // editor 모듈 lazy import — circular 회피 (editor가 vault를 import하고 vault가 watcher를 알 수 있음)
  const editor = await import("./editor");
  if (get(editor.isDirty)) {
    externalConflict.set({ path, externalMtimeMs: mtimeMs });
    return;
  }
  // dirty 아니면 그냥 fresh load
  try {
    const fresh = await readNote(path);
    editor.markSaved(fresh);
  } catch (e) {
    logWarn("stores/watcher", "[watcher] readNote on external change failed:", e);
  }
}

/**
 * 변경 burst 안정화 후(500ms) 모은 변경분을 증분 재인덱싱. 진행 중인 작업이 있으면
 * 변경분을 보존한 채 재예약(누락 방지).
 */
let reindexTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleIncrementalReindex(): void {
  if (reindexTimer) clearTimeout(reindexTimer);
  reindexTimer = setTimeout(runReindex, 500);
}

async function runReindex(): Promise<void> {
  reindexTimer = null;

  if (pendingFullReload) {
    // ⚠️ 모아 둔 증분은 버린다 — 어차피 전체를 다시 읽는다.
    pendingChanged.clear();
    pendingRemoved.clear();
    let done = false;
    try {
      done = await requestFullReload();
    } catch (e) {
      logWarn("stores/watcher", "[watcher] 폴더 변경 후 전체 재읽기 실패:", e);
      done = true; // 에러는 재시도 안 함 — 무한 루프 방지(증분 쪽과 같은 규율)
    }
    // 🔴 바빠서 못 했으면 **깃발을 내리지 않는다.** 내리면 폴더 이름 바꾸기가 조용히 씹힌다.
    if (done) pendingFullReload = false;
    else scheduleIncrementalReindex();
    return;
  }

  if (pendingChanged.size === 0 && pendingRemoved.size === 0) return;
  const changed = Array.from(pendingChanged);
  const removed = Array.from(pendingRemoved);
  pendingChanged.clear();
  pendingRemoved.clear();
  let handled = true;
  try {
    handled = await reindexIncremental(changed, removed);
  } catch (e) {
    logWarn("stores/watcher", "[watcher] 증분 재인덱싱 실패:", e);
    handled = true; // 에러는 재시도 안 함(무한 루프 방지) — 다음 변경 때 정정
  }
  if (!handled) {
    // 다른 reload/reindex 진행 중 — 변경분 복원 후 재예약.
    changed.forEach((p) => pendingChanged.add(p));
    removed.forEach((p) => pendingRemoved.add(p));
    scheduleIncrementalReindex();
  }
}

/** 충돌 해결 — 사용자가 "외부 변경 사용" 선택 */
export async function resolveConflictAcceptExternal(): Promise<void> {
  const conflict = get(externalConflict);
  if (!conflict) return;
  try {
    const { markSaved } = await import("./editor");
    const fresh = await readNote(conflict.path);
    markSaved(fresh);
    externalConflict.set(null);
  } catch (e) {
    // ⚠️ 충돌을 **안 닫는다.** 닫으면 사용자는 해결된 줄 알고 계속 편집하다가 다음
    //    저장에서 남의 변경을 덮어쓴다. 대신 왜 안 됐는지를 화면에 남긴다.
    logError("stores/watcher", "accept external failed:", e);
    pushAlert("conflict-failed", m.alert_conflict_failed(), String(e));
  }
}

/** 충돌 해결 — 사용자가 "내 변경 유지" 선택 (다음 저장 시 덮어쓰기) */
export function resolveConflictKeepLocal(): void {
  externalConflict.set(null);
}
