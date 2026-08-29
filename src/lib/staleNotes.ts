/**
 * 오래 안 건드린 노트.
 *
 * ## ⚠️ 이건 "고쳐라"가 아니다
 *
 * 감사 다른 것들은 **틀린 것**을 가리킨다(끊긴 링크·갈린 값). 이건 아니다. 6개월 된
 * 문서가 낡았다는 뜻은 아니고, 그냥 **다시 볼 때가 됐는지 묻는 목록**이다.
 * `vaultAudit` 이 "판단하지 않는다"고 못박은 그 태도 그대로다.
 *
 * ## ⚠️ 그래서 무엇을 세느냐가 중요하다
 *
 * `mtime` 은 파일을 만졌는지만 말한다 — git 이동·일괄 치환도 `mtime` 을 바꾼다.
 * 그래도 이 앱이 가진 유일한 "언제"이고, 다른 축(frontmatter `date`)은 손으로 적는
 * 값이라 안 고치면 안 바뀐다. **둘 중 더 최근을 쓴다** — 어느 쪽이든 손댄 흔적이다.
 */

/** 이보다 오래되면 목록에 든다. 6개월 — 반기에 한 번은 돌아본다는 뜻. */
export const STALE_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface StaleNote {
  path: string;
  /** 마지막으로 손댄 시각(ms). */
  at: number;
  /** 며칠 됐나. 화면이 이걸 그대로 쓴다. */
  days: number;
}

export interface StaleInput {
  path: string;
  /** 파일 수정 시각. 모르면 `null`. */
  mtimeMs: number | null;
  /** frontmatter `date` 를 파싱한 값. 없으면 `null`. */
  dateMs: number | null;
}

/**
 * 오래된 것부터.
 *
 * ⚠️ **시각을 모르는 노트는 뺀다.** "모른다"를 "아주 오래됐다"로 세면 인덱스가 덜 찬
 * 순간에 vault 전체가 목록에 뜬다 — 그러면 아무도 이 목록을 안 믿는다.
 *
 * @param now 기준 시각. **인자로 받는다** — 안 그러면 테스트가 시계에 의존한다.
 */
export function findStaleNotes(
  notes: readonly StaleInput[],
  now: number,
  days = STALE_DAYS,
): StaleNote[] {
  const cutoff = now - days * DAY_MS;
  const out: StaleNote[] = [];
  for (const n of notes) {
    // 둘 중 더 최근 — 어느 쪽이든 손댄 흔적이다.
    const at = Math.max(n.mtimeMs ?? Number.NEGATIVE_INFINITY, n.dateMs ?? Number.NEGATIVE_INFINITY);
    if (!Number.isFinite(at)) continue;
    if (at > cutoff) continue;
    // ⚠️ 미래 시각은 버린다 — 시계가 어긋난 파일이 "0일 전"으로 목록 맨 위에 선다.
    if (at > now) continue;
    out.push({ path: n.path, at, days: Math.floor((now - at) / DAY_MS) });
  }
  return out.sort((a, b) => a.at - b.at || a.path.localeCompare(b.path));
}
