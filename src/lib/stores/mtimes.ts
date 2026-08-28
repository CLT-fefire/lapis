import { get, writable } from "svelte/store";
import { vaultFileStats } from "$lib/tauri/notes";
import { logWarn } from "$lib/stores/usage";

/**
 * 노트 경로 → 파일 수정 시각(ms). **시간축 정렬의 앱 쪽 데이터원.**
 *
 * ## ⚠️ 왜 스토어에 들고 있나
 *
 * 앱은 전체 mtime 지도를 갖고 있지 않았다. `NoteEntry`(파일 트리)에 mtime이 없고,
 * `FileStat[]`은 델타 경로에서만 가져와 캐시 커밋용으로 잠깐 쓴다. `unread.ts`는
 * **열람 이력이 있는 경로만** 본다.
 *
 * 지연 로드로 두지 않는 이유는 성능이 아니라 **일관성**이다. 열 때마다 새로 읽으면
 * "팔레트의 최근 변경"과 다른 화면이 **서로 다른 시점의 mtime**을 보게 된다 — 같은 값이
 * 두 벌이 되는, 이 저장소가 반복해서 앓은 병이다.
 *
 * 19,000 × {경로, 숫자}는 메모리상 무의미하다.
 *
 * ## 갱신
 *
 * vault를 열 때 한 번 전량 로드하고, 그 뒤는 watcher가 증분으로 고친다. 그 배관은
 * `unread.ts`가 이미 하는 것과 같은 이벤트를 탄다.
 */

export const noteMtimes = writable<Map<string, number>>(new Map());

/** vault를 열 때 한 번. 실패해도 던지지 않는다 — 정렬이 안 되는 것뿐이다. */
export async function primeMtimes(vaultPath: string): Promise<void> {
  try {
    const stats = await vaultFileStats(vaultPath);
    const next = new Map<string, number>();
    for (const f of stats.files) next.set(f.path, f.mtime_ms);
    noteMtimes.set(next);
  } catch (e) {
    logWarn("stores/mtimes", "[mtimes] 초기 로드 실패 — 시간축 정렬이 빈 값으로 떨어진다", e);
    noteMtimes.set(new Map());
  }
}

/** watcher의 수정 이벤트. */
export function touchMtime(path: string, mtimeMs: number): void {
  noteMtimes.update((m) => {
    // ⚠️ 새 Map을 만들어야 스토어 구독자가 갱신을 본다. 제자리 수정은 조용히 안 보인다.
    const next = new Map(m);
    next.set(path, mtimeMs);
    return next;
  });
}

/** watcher의 삭제·이동 이벤트. 남겨두면 없는 노트가 목록에 뜬다. */
export function dropMtime(path: string): void {
  noteMtimes.update((m) => {
    if (!m.has(path)) return m;
    const next = new Map(m);
    next.delete(path);
    return next;
  });
}

export function resetMtimes(): void {
  noteMtimes.set(new Map());
}

/** `$lib/recency`의 `TimeOf`로 넘길 조회 함수. */
export function mtimeOf(path: string): number | null {
  return get(noteMtimes).get(path) ?? null;
}
