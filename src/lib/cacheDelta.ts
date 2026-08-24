import type { FileStat } from "$lib/tauri/notes";

/**
 * **기동 델타 재조정** — 앱이 꺼져 있던 동안의 변경을 "바뀐 파일만" 고치기 위한 판정.
 *
 * ## 왜 필요한가
 *
 * `vault_fingerprint`는 vault 전량의 `(path, mtime, size)`를 한 덩어리로 해싱한다.
 * 그래서 `meta.fingerprint !== fp.fingerprint` 한 줄이 hit/miss를 가르고, **노트 1개가
 * 바뀌어도 전량 재빌드**였다. 실측(19,364 노트 vault):
 *
 * | | |
 * |---|---:|
 * | 풀 빌드 addAll (벤치 275ms/1000노트 환산) | ≈ 5.3 s |
 * | + `read_vault_bundle` 본문 IPC | 52.6 MB |
 * | 하루 사이 실제로 바뀐 md | **38개 (0.2%)** |
 * | 최근 30일 중 변경이 있었던 날 | **19일** |
 *
 * 즉 평상시 기동의 대다수가 miss고, 그때마다 0.2% 때문에 100%를 다시 읽었다.
 *
 * ## 왜 새 기계장치가 거의 없는가
 *
 * 증분 반영 자체는 이미 있다 — watcher 경로의 `reindexIncremental`이 `scanLinkSingle` +
 * `workerUpdateDoc`/`workerRemoveDoc`로 정확히 그 일을 한다. 빠져 있던 건 **앱이 꺼져
 * 있던 동안의 델타를 계산할 근거**(이전 스냅샷의 파일별 stat) 하나였다.
 *
 * 이 모듈은 그 판정만 담는 leaf다. IO도 store도 만지지 않아 Node 테스트에서 그대로
 * import 된다 — `fullTextOptions`·`snippet`과 같은 이유다.
 */

/** 이전 스냅샷 → 현재의 차이. 경로는 전부 절대 경로(`LinkInfo.source_path`와 같은 키). */
export interface CacheDelta {
  /** 이전 스냅샷에 없던 파일. */
  added: string[];
  /** 있었지만 mtime/size가 달라진 파일. */
  modified: string[];
  /** 사라진 파일. */
  removed: string[];
  /** 현재 walk가 본 파일 수 = 델타 적용 후의 노트 수. */
  noteCount: number;
}

/**
 * 두 stat 스냅샷의 차이.
 *
 * `added`/`modified`를 가르는 이유는 하나뿐 — **노트 수 변화**다(`added`만 늘린다).
 * 적용 방식은 둘이 같으므로 호출부는 `touchedPaths()`로 합쳐 쓴다.
 */
export function diffFileStats(prev: FileStat[], cur: FileStat[]): CacheDelta {
  const before = new Map<string, FileStat>();
  for (const f of prev) before.set(f.path, f);

  const added: string[] = [];
  const modified: string[] = [];
  const seen = new Set<string>();
  for (const f of cur) {
    seen.add(f.path);
    const b = before.get(f.path);
    if (!b) added.push(f.path);
    else if (b.mtime_ms !== f.mtime_ms || b.size !== f.size) modified.push(f.path);
  }

  const removed: string[] = [];
  for (const f of prev) {
    if (!seen.has(f.path)) removed.push(f.path);
  }

  return { added, modified, removed, noteCount: cur.length };
}

/** 다시 읽어야 하는 경로 — 신규와 수정은 적용이 같다(`scanLinkSingle` → 인덱스 반영). */
export function touchedPaths(delta: CacheDelta): string[] {
  return [...delta.added, ...delta.modified];
}

/** 델타를 적용할지, 풀 빌드로 떨어질지. `reason`은 dev 로그용. */
export type DeltaVerdict =
  | { apply: true }
  | { apply: false; reason: "empty" | "too-many" | "shard-count-change" };

export interface DeltaGateInput {
  delta: CacheDelta;
  /** 디스크 shard 수 (= `meta.shard_count`). */
  metaShardCount: number;
  /** 노트 수 → shard 수. `decideShardCount`를 주입해 이 모듈을 leaf로 유지한다. */
  decideShardCount: (noteCount: number) => number;
  /** 이 개수를 넘는 변경은 풀 빌드가 더 단순/안전 (watcher 경로와 같은 상한). */
  max: number;
}

/**
 * 델타 적용 가능 판정. **세 갈래로만 거절한다.**
 *
 * - `empty` — fingerprint는 어긋났는데 델타가 0건. 있어선 안 되는 조합이라(해시 충돌,
 *   또는 stat이 못 보는 in-place write) **믿지 않고 풀 빌드**한다. 여기서 "변경 없음"으로
 *   처리하면 캐시가 실제로 낡았을 때 그 상태를 영구히 고정한다.
 * - `too-many` — 상한 초과. 바뀐 파일 하나하나에 `scanLinkSingle` + `readNote` IPC가
 *   붙으므로, 많아지면 `read_vault_bundle` 한 번(rayon 병렬)이 더 싸다.
 * - `shard-count-change` — shard 수가 바뀌면 `computeShardId`의 결과가 **모든 문서에서**
 *   달라진다. 디스크 shard를 재사용할 수 없다.
 */
export function deltaGate(input: DeltaGateInput): DeltaVerdict {
  const { delta, metaShardCount, decideShardCount, max } = input;
  const touched = delta.added.length + delta.modified.length + delta.removed.length;

  if (touched === 0) return { apply: false, reason: "empty" };
  if (touched > max) return { apply: false, reason: "too-many" };
  if (decideShardCount(delta.noteCount) !== metaShardCount) {
    return { apply: false, reason: "shard-count-change" };
  }

  return { apply: true };
}
