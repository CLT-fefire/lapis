import { CYCLE_MODES, type PaletteMode } from "$lib/palette";

/**
 * 저장된 검색 — **질의 + 모드 + 스코프**를 이름 붙여 둔다.
 *
 * ## ⚠️ 왜 필요한가
 *
 * 한눈에 보기에는 **저장뷰**가 있는데(`lapis.table-views`) 검색에는 없었다. 같은 질문을
 * 매일 다시 조립하게 된다 — `⌘⇧F` → 전문 모드 → 스코프 고르기 → 질의.
 *
 * ⚠️ **스코프를 같이 저장한다.** 질의만 저장하면 다른 프로젝트를 보던 중에 불렀을 때
 * 엉뚱한 결과가 나오고, 그건 저장된 검색이 고장 난 것처럼 읽힌다.
 */

export interface SavedSearch {
  /** 사용자가 보는 이름. 비면 질의를 쓴다. */
  name: string;
  query: string;
  mode: PaletteMode;
  /** 경로 접두사. `null` 이면 vault 전부. */
  scope: string | null;
}

export const SAVED_SEARCH_KEY = "lapis.saved-searches";
/** ⚠️ 상한이 없으면 팔레트가 저장된 검색으로 덮인다. */
export const SAVED_SEARCH_MAX = 20;

/** 이름이 비었으면 질의를 이름으로. 둘 다 비면 저장할 것이 없다. */
export function displayName(s: SavedSearch): string {
  const n = s.name.trim();
  if (n !== "") return n;
  const q = s.query.trim();
  return q === "" ? "(빈 검색)" : q;
}

/**
 * 같은 검색인가 — **이름이 아니라 내용**으로 본다.
 *
 * ⚠️ 이름으로 보면 같은 질의를 이름만 바꿔 여러 번 저장하게 된다. 반대로 내용으로 보면
 * 이름을 고치는 것이 "덮어쓰기"가 되어 자연스럽다.
 */
export function sameSearch(a: SavedSearch, b: SavedSearch): boolean {
  return a.query.trim() === b.query.trim() && a.mode === b.mode && a.scope === b.scope;
}

/** 저장 — 같은 내용이 있으면 이름만 갱신하고 **맨 앞으로** 올린다. */
export function upsert(list: readonly SavedSearch[], next: SavedSearch): SavedSearch[] {
  const rest = list.filter((s) => !sameSearch(s, next));
  return [next, ...rest].slice(0, SAVED_SEARCH_MAX);
}

export function remove(list: readonly SavedSearch[], target: SavedSearch): SavedSearch[] {
  return list.filter((s) => !sameSearch(s, target));
}

/**
 * 저장값 → 목록. 못 읽는 항목은 **버리고 나머지는 살린다**.
 *
 * ⚠️ 한 항목이 깨졌다고 전부 잃으면, 목록을 저장해 둔 뜻이 사라진다.
 */
export function parseSaved(raw: unknown): SavedSearch[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedSearch[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.query !== "string") continue;
    const mode =
      typeof o.mode === "string" && (CYCLE_MODES as readonly string[]).includes(o.mode)
        ? (o.mode as PaletteMode)
        : "all";
    out.push({
      name: typeof o.name === "string" ? o.name : "",
      query: o.query,
      mode,
      // ⚠️ 빈 문자열은 `null` 로 떨어뜨린다 — `""` 접두사는 **전부 통과**라 스코프가 없는
      //    것과 같은데, 화면에는 스코프가 걸린 것처럼 보인다.
      scope: typeof o.scope === "string" && o.scope.trim() !== "" ? o.scope : null,
    });
    if (out.length >= SAVED_SEARCH_MAX) break;
  }
  return out;
}
