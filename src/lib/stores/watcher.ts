import { writable, get } from "svelte/store";
import { watchVault, unwatchVault, onVaultChange, type VaultChange } from "$lib/tauri/watcher";
import { scanLinkSingle, readNote } from "$lib/tauri/notes";
import { invalidateCacheBySource } from "$lib/backlinks";
import {
  vaultPath,
  currentNotePath,
  linkIndex,
  reloadNotes,
  closeTab,
} from "./vault";

export type WatcherStatus = "idle" | "watching" | "error";

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
    console.error("[watcher] start failed:", e);
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
    console.warn("[watcher] stop failed:", e);
  }
  watcherStatus.set("idle");
}

/**
 * 이벤트 → 부분 인덱스 갱신.
 * - modified: scan_link_single로 LinkInfo만 받아 patch
 * - removed: 인덱스에서 삭제
 * - renamed: 삭제 + 추가
 *
 * 단순화를 위해 트리 + linkIndex만 patch. tagIndex/facetCounts/searchIndex는
 * 한 burst 묶음 처리 후 reloadNotes로 전체 재빌드 (cost 작음).
 */
async function handleChange(change: VaultChange): Promise<void> {
  const root = get(vaultPath);
  if (!root) return;

  switch (change.kind) {
    case "modified":
      await onPathChanged(change.path, change.mtime_ms);
      break;
    case "created":
      // 현재 정책상 emit 안 함 (Rust에서 Modified로 통합). future-proof.
      await onPathChanged(change.path, Date.now());
      break;
    case "removed":
      onPathRemoved(change.path);
      break;
    case "renamed":
      onPathRemoved(change.from);
      await onPathChanged(change.to, Date.now());
      break;
  }

  // 큰 변경 burst 시 정확성 위해 전체 재빌드를 약간 늦게 한 번 더 실행.
  scheduleFullReload();
}

async function onPathChanged(path: string, mtimeMs: number): Promise<void> {
  const root = get(vaultPath);
  if (!root) return;

  // 본문이 바뀌었으니 이 path를 source로 하는 백링크 snippet 캐시는 stale.
  invalidateCacheBySource(path);

  // 현재 노트가 영향 받으면 충돌 처리
  const cur = get(currentNotePath);
  if (cur === path) {
    await reconcileCurrentNote(path, mtimeMs);
  }

  // 인덱스 patch
  try {
    const info = await scanLinkSingle(root, path);
    linkIndex.update((idx) => {
      if (!idx) return idx;
      // byPath 갱신
      idx.byPath.set(info.source_path, info);
      // resolver/backlinks 재빌드는 비용 — burst 후 reloadNotes로 전체 재빌드 처리.
      // 단일 patch만으론 일관성 미약하지만, scheduleFullReload가 곧 정정.
      return idx;
    });
  } catch (e) {
    console.warn("[watcher] scanLinkSingle failed:", e);
  }
}

function onPathRemoved(path: string): void {
  // 이 path를 source로 하는 백링크 snippet 캐시 정리. target으로 가리키는 항목들은
  // linkIndex.byPath.delete 후 backlinks 패널이 더 이상 요청 안 함.
  invalidateCacheBySource(path);

  linkIndex.update((idx) => {
    if (!idx) return idx;
    idx.byPath.delete(path);
    return idx;
  });

  // 외부 삭제 — 탭에서 제거(열려 있었다면) + 활성이었으면 인접 탭으로/빈 상태.
  void closeTab(path);

  // notes 트리는 reloadNotes로 정확히 정정됨 (scheduleFullReload)
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
    console.warn("[watcher] readNote on external change failed:", e);
  }
}

/**
 * 변경 burst 안정화 후 전체 reloadNotes 호출.
 * 같은 burst 안에서 여러 번 호출돼도 마지막 호출 기준 500ms 후 1회만 실행.
 */
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFullReload(): void {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    void reloadNotes().catch((e) => console.warn("[watcher] reloadNotes failed:", e));
  }, 500);
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
    console.error("[watcher] accept external failed:", e);
  }
}

/** 충돌 해결 — 사용자가 "내 변경 유지" 선택 (다음 저장 시 덮어쓰기) */
export function resolveConflictKeepLocal(): void {
  externalConflict.set(null);
}
