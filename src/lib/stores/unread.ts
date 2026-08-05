import { writable } from "svelte/store";
import { notesMtimes } from "$lib/tauri/notes";

/**
 * "안 본 사이 바뀐 노트" — Discord unread의 번역 (2026-08-05 PR-11).
 *
 * Lapis는 읽기·탐색이 주 용도고 편집은 외부 도구로 이뤄진다. 그래서 실제 질문은
 * "내가 안 본 사이 뭐가 바뀌었나"이고, watcher가 이미 그 정보를 갖고 있다.
 *
 * 판정: `mtime > lastOpened[path]` → 변경됨.
 * **한 번도 안 연 노트는 대상이 아니다** — 12000개가 전부 볼드가 되면 신호가 죽는다.
 * 이건 "새 파일 알림"이 아니라 "내가 읽은 뒤 바뀐 것"이다.
 *
 * 두 경로로 갱신된다:
 *  - 시동 시 `syncFromDisk()` — 열람 이력이 있는 경로만 stat (앱이 꺼져 있던 동안의 변경)
 *  - 실행 중 `markChangedFromWatcher()` — watcher의 Modified 이벤트
 */

const LAST_OPENED_KEY = "lapis.last-opened";

/** path → 마지막으로 연 시각(epoch ms). 연 적 없는 노트는 키 자체가 없다. */
type LastOpened = Record<string, number>;

/** 마지막 열람 이후 외부에서 바뀐 노트 경로들. */
export const changedNotes = writable<Set<string>>(new Set());

function loadLastOpened(): LastOpened {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(LAST_OPENED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as LastOpened) : {};
  } catch {
    return {};
  }
}

function saveLastOpened(m: LastOpened): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LAST_OPENED_KEY, JSON.stringify(m));
  } catch {
    /* quota 초과 등 — 열람 이력은 소실돼도 기능이 죽지 않는다(표시만 안 될 뿐) */
  }
}

let lastOpened: LastOpened = loadLastOpened();

/** 노트를 연 시점 기록 + "변경됨" 해제. selectNote에서 호출. */
export function markOpened(path: string, at: number): void {
  lastOpened[path] = at;
  saveLastOpened(lastOpened);
  changedNotes.update((s) => {
    if (!s.has(path)) return s; // 불필요한 구독자 알림 방지
    const next = new Set(s);
    next.delete(path);
    return next;
  });
}

/**
 * watcher Modified 이벤트 → 열람 이력이 있고 그 이후 수정됐으면 "변경됨".
 * 지금 열어 보고 있는 노트는 호출부가 걸러낸다(읽는 중에 볼드가 되면 혼란).
 */
export function markChangedFromWatcher(path: string, mtimeMs: number): void {
  const opened = lastOpened[path];
  if (opened === undefined || mtimeMs <= opened) return;
  changedNotes.update((s) => {
    if (s.has(path)) return s;
    const next = new Set(s);
    next.add(path);
    return next;
  });
}

/**
 * 시동 시 1회 — 열람 이력이 있는 경로만 mtime을 확인해 밀린 변경을 복원한다.
 * 앱이 꺼져 있는 동안 외부에서 편집된 경우가 여기서 잡힌다.
 */
export async function syncFromDisk(vaultPath: string): Promise<void> {
  const paths = Object.keys(lastOpened);
  if (paths.length === 0) return;
  try {
    const rows = await notesMtimes(vaultPath, paths);
    const changed = new Set<string>();
    const alive = new Set<string>();
    for (const [path, mtimeMs] of rows) {
      alive.add(path);
      const opened = lastOpened[path];
      if (opened !== undefined && mtimeMs > opened) changed.add(path);
    }
    // 사라진 노트의 열람 이력은 정리 — 안 그러면 localStorage가 단조 증가한다.
    if (alive.size !== paths.length) {
      const pruned: LastOpened = {};
      for (const p of alive) pruned[p] = lastOpened[p];
      lastOpened = pruned;
      saveLastOpened(lastOpened);
    }
    changedNotes.set(changed);
  } catch (e) {
    // 실패해도 앱 기능에는 영향이 없다 — 표시만 안 될 뿐.
    console.warn("[unread] syncFromDisk failed", e);
  }
}

/** 테스트·초기화용. */
export function resetUnreadState(): void {
  lastOpened = {};
  saveLastOpened(lastOpened);
  changedNotes.set(new Set());
}

/** 현재 열람 이력(읽기 전용 복사본) — 테스트용. */
export function peekLastOpened(): LastOpened {
  return { ...lastOpened };
}
