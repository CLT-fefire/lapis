/**
 * 태그 하나가 질의에 걸리나 — **이 규칙이 사는 유일한 자리.**
 *
 * ## 🔴 왜 모았나
 *
 * 같은 질문에 두 곳이 다르게 답하고 있었다:
 *
 * | 어디 | 정규화 | 결과 |
 * |---|---|---|
 * | `core/query.ts` 의 `tag` 축 | `norm()` = **NFC 만** | 대소문자를 가린다 |
 * | `tagIndex.ts` 의 `buildTagIndex` | `trim().toLowerCase()` | 안 가린다 |
 *
 * 즉 `subject/UI` 와 `subject/ui` 를 앱의 태그 패널은 **한 태그로**, MCP·CLI 의 `tag:`
 * 질의는 **다른 태그로** 봤다.
 *
 * ⚠️ **이 vault 에서는 0건이다** — 423회 등장하는 85개 태그 중 대소문자만 다른 묶음이
 * 없다(2026-08-30 실측). 그러니 이건 **보험이지 성과가 아니다.** 다만 축을 하나 더
 * 늘리기 전에 변종을 셋으로 만들 수는 없어서 여기로 모았다.
 *
 * ## 규칙
 *
 * - **NFC + 소문자 + trim** 으로 맞춘다. 관대한 쪽을 고른다 — 태그는 사람이 손으로 쓴다.
 * - **정확 일치 또는 nested 접두사**: `tech` 는 `tech` 와 `tech/*` 를 잡는다.
 *   `techno` 는 안 잡는다(`/` 경계를 요구한다).
 */

/** 비교용 정규형. 화면에 쓰지 말 것 — 표시 케이스는 `tagIndex` 가 따로 센다. */
export function normTag(raw: string): string {
  return raw.normalize("NFC").trim().toLowerCase();
}

/**
 * 노트의 태그 하나가 원하는 태그에 걸리나.
 *
 * ⚠️ 방향이 있다. `wanted` 가 상위여야 걸린다 — `tech` 로 물으면 `tech/rust` 가 걸리지만
 * `tech/rust` 로 물으면 `tech` 는 안 걸린다. 좁혀 묻는 것이 넓은 결과를 내면 안 된다.
 */
export function tagMatches(noteTag: string, wanted: string): boolean {
  const n = normTag(noteTag);
  const w = normTag(wanted);
  if (!w) return false;
  return n === w || n.startsWith(w + "/");
}

/** 이 노트가 원하는 태그를 가졌나. */
export function noteHasTag(tags: readonly string[] | undefined, wanted: string): boolean {
  return (tags ?? []).some((t) => tagMatches(t, wanted));
}

/**
 * 여러 태그 중 **하나라도** 걸리면 참 — 같은 축 안은 OR 이라는 앱의 규칙 그대로다.
 *
 * ⚠️ `wanted` 가 비면 **참**이다. "안 고른 축은 안 거른다"는 계약이고, `filterRows` 와
 * `applyFilters` 가 같은 규칙을 쓴다. 거짓으로 두면 태그를 안 고른 질의가 전부 사라진다.
 */
export function noteHasAnyTag(
  tags: readonly string[] | undefined,
  wanted: Iterable<string>,
): boolean {
  const list = [...wanted];
  if (list.length === 0) return true;
  return list.some((w) => noteHasTag(tags, w));
}
