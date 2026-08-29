/**
 * 읽던 자리 — 노트별로 어디까지 봤나.
 *
 * ## ⚠️ 왜 필요한가
 *
 * 이 앱은 읽기가 기본이고, 같은 긴 문서로 계속 돌아온다. 실측(사용 로그): 네 세션이
 * **전부 같은 노트를 `via: tab` 으로** 열었다. 그때마다 맨 위에서 다시 시작했다.
 *
 * ## ⚠️ 조용히 틀리는 방법이 둘
 *
 * 1. **남의 자리로 복원한다.** 노트를 바꾸는 순간 이전 노트의 위치를 새 본문에 적용하면
 *    엉뚱한 데로 튀고, 사용자는 자기가 스크롤한 줄 안다. 자리는 **경로로만** 찾는다.
 * 2. **끝없이 자란다.** 열어 본 노트마다 한 줄씩 쌓이면 19,000 노트 vault 에서 실제
 *    문제가 된다. 상한을 두고 오래된 것부터 버린다.
 *
 * ## ⚠️ 편집기는 픽셀이 아니라 줄이다
 *
 * CodeMirror 의 `scrollTop` 은 height map 이 지연 계산이라 못 믿는다 —
 * `Editor.svelte` 에 그 실측이 적혀 있다(같은 문서 `scrollHeight` 10902 ↔ 21385).
 * 그래서 편집기는 `line` 을, 미리보기는 `scroll` 을 쓴다.
 */

import { get, writable } from "svelte/store";

/** 자리 하나. */
export interface ReadingPos {
  /** 미리보기 컨테이너의 `scrollTop`. */
  scroll: number;
  /** 편집기의 맨 위 보이는 줄(1-based). 없으면 편집기를 안 썼다는 뜻. */
  line?: number;
}

/**
 * 몇 개까지 들고 있나.
 *
 * ⚠️ 큰 vault 에서 `localStorage` 가 계속 커지는 것을 막는다. 200 이면 최근 작업 범위를
 * 충분히 덮으면서 저장 크기는 수십 KB 다.
 */
export const POSITIONS_MAX = 200;

const KEY = "lapis.reading-pos";

/** ⚠️ **삽입 순서가 최근 순이다** — `Map` 이 그것을 보장하므로 별도 시각을 안 든다. */
/**
 * ⚠️ **구독용으로만 내보낸다.** 읽기는 `posFor`, 쓰기는 `rememberPos` 를 쓴다 —
 * 밖에서 `set` 하면 LRU 상한과 영속화를 건너뛰게 된다.
 * 페널이 표식을 그릴 때 자리가 바뀌면 따라오게 하려면 이걸 구독해야 한다.
 */
export const positions = writable<Map<string, ReadingPos>>(loadPositions());

function loadPositions(): Map<string, ReadingPos> {
  if (typeof localStorage === "undefined") return new Map();
  try {
    return parsePositions(localStorage.getItem(KEY) ?? "");
  } catch {
    return new Map();
  }
}

function save(map: Map<string, ReadingPos>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    // ⚠️ quota·private 모드 — 자리를 못 저장한다고 앱이 죽으면 안 된다.
  }
}

/**
 * 저장된 문자열 → 자리 지도.
 *
 * ⚠️ **깨진 값에 던지지 않는다.** 여기서 죽으면 앱이 안 뜬다 — 자리 기억 하나 때문에
 * 그럴 이유가 없다. 모양이 틀린 항목만 버린다.
 */
export function parsePositions(raw: string): Map<string, ReadingPos> {
  const out = new Map<string, ReadingPos>();
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [path, val] of Object.entries(v as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const o = val as Record<string, unknown>;
    if (typeof o.scroll !== "number" || !Number.isFinite(o.scroll) || o.scroll < 0) continue;
    const line = typeof o.line === "number" && Number.isFinite(o.line) && o.line > 0 ? o.line : undefined;
    out.set(path, { scroll: o.scroll, ...(line === undefined ? {} : { line }) });
  }
  return out;
}

export function serializePositions(): string {
  return JSON.stringify(Object.fromEntries(get(positions)));
}

/** 이 노트의 자리. 없으면 `null`. */
export function posFor(path: string): ReadingPos | null {
  return get(positions).get(path) ?? null;
}

/**
 * 자리를 적는다.
 *
 * ⚠️ **맨 위는 안 적는다.** 0 을 저장하면 "아직 안 읽음"과 "맨 위로 올려 뒀음"이 구별이
 * 안 되고 항목만 쌓인다. 이미 있던 자리는 지운다 — 맨 위로 올린 것은 "여기서 다시
 * 시작하겠다"는 뜻이다.
 */
export function rememberPos(path: string, pos: ReadingPos): void {
  if (!path) return;
  const atTop = pos.scroll <= 0 && pos.line === undefined;
  positions.update((m) => {
    const next = new Map(m);
    if (atTop) {
      next.delete(path);
    } else {
      // ⚠️ 지웠다 다시 넣는다 — `Map` 의 삽입 순서를 **최근 순**으로 유지하려고.
      //    안 그러면 자주 보는 노트가 먼저 밀려난다.
      next.delete(path);
      next.set(path, pos);
      while (next.size > POSITIONS_MAX) {
        const oldest = next.keys().next().value;
        if (oldest === undefined) break;
        next.delete(oldest);
      }
    }
    save(next);
    return next;
  });
}

/** 주어진 경로만 남긴다 — vault 를 바꿀 때 남의 vault 자리를 안 들고 있으려고. */
export function pruneTo(keep: readonly string[]): void {
  const set = new Set(keep);
  positions.update((m) => {
    const next = new Map([...m].filter(([p]) => set.has(p)));
    save(next);
    return next;
  });
}

export function clearPositions(): void {
  positions.set(new Map());
  save(new Map());
}
