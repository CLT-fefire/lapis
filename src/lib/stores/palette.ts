import { get, writable } from "svelte/store";
import { CYCLE_MODES, type PaletteMode } from "$lib/palette";
import {
  SAVED_SEARCH_KEY,
  parseSaved,
  upsert,
  remove,
  type SavedSearch,
} from "$lib/savedSearch";

export const paletteOpen = writable<boolean>(false);
/**
 * 지금 팔레트가 어느 **모드**인가.
 *
 * 세 입구가 같은 상태를 가리킨다:
 * - 단축키 — `⌘P` → `files`, `⌘⇧F` → `fulltext`, `⌘K` → **마지막 모드**
 * - 입력 접두사 — `>` · `#` · `:` (모드가 `all` 일 때만 본다)
 * - `⇥` 순환 — `CYCLE_MODES` 넷
 *
 * ⚠️ 이름은 옛날 그대로다(`hintMode`). "힌트"였을 때는 접두사가 이기고 이 값이 지는
 * 관계였는데, 3.0 에서는 이 값이 모드 그 자체다.
 */
export const paletteHintMode = writable<PaletteMode>("all");

const LAST_MODE_KEY = "lapis.palette-mode";

function isCycleMode(v: unknown): v is PaletteMode {
  return typeof v === "string" && (CYCLE_MODES as readonly string[]).includes(v);
}

/**
 * `⌘K` 가 열 모드.
 *
 * ⚠️ **순환 넷만 기억한다.** `tag`·`facet` 은 접두사를 쳐서 들어가는 곳이라, 그걸
 * 기억했다가 다음 `⌘K` 에 재현하면 입력창은 비어 있는데 태그만 나오는 화면이 된다 —
 * 사용자가 방금 한 일과 연결이 안 되는 상태다.
 */
export function loadLastPaletteMode(): PaletteMode {
  if (typeof localStorage === "undefined") return "all";
  try {
    const raw = localStorage.getItem(LAST_MODE_KEY);
    return isCycleMode(raw) ? raw : "all";
  } catch {
    return "all";
  }
}

export const lastPaletteMode = writable<PaletteMode>(loadLastPaletteMode());

lastPaletteMode.subscribe((mode) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LAST_MODE_KEY, mode);
  } catch {
    /* localStorage 사용 불가(테스트 stub 등) — 무시 */
  }
});

/**
 * 팔레트에서 고른 노트를 **어느 탭에** 열지.
 * - `new-tab` (기본): 탭을 추가한다. ⌘K·⌘T 등 기존 경로 전부.
 * - `replace`: 활성 탭을 갈아끼운다. ⌘P(Quick File Open) 전용 — "잠깐 보기".
 */
export type PaletteOpenIntent = "new-tab" | "replace";

export const paletteIntent = writable<PaletteOpenIntent>("new-tab");

const SCOPE_KEY = "lapis.palette-scope";
const AXIS_KEY = "lapis.recency-axis";

/**
 * "최근 바뀐"이 **어느 시각**을 보나.
 *
 * - `mtime` — 파일 수정 시각. 바깥 도구가 건드려도 움직인다
 * - `date` — frontmatter `date`. 사람이 적은 날짜다
 *
 * ⚠️ CLI·MCP 는 `--by mtime|date` 로 **둘 다** 받는데 앱은 `mtime` 고정이었다.
 * 실측: `date` 가 있는 107노트 중 **42건이 mtime 과 날짜가 다르다** — 즉 두 축은 이
 * vault 에서 실제로 갈린다. 한쪽만 보여주면 나머지 42건은 물어볼 방법이 없다.
 */
export type RecencyAxis = "mtime" | "date";

export const recencyAxis = writable<RecencyAxis>(loadAxis());

function loadAxis(): RecencyAxis {
  if (typeof localStorage === "undefined") return "mtime";
  try {
    return localStorage.getItem(AXIS_KEY) === "date" ? "date" : "mtime";
  } catch {
    return "mtime";
  }
}

recencyAxis.subscribe((v) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(AXIS_KEY, v);
  } catch {
    /* 무시 */
  }
});

export function setRecencyAxis(v: RecencyAxis): void {
  recencyAxis.set(v);
}

/**
 * 팔레트 스코프 — **"이 아래에서만"** 경로 접두사. `null` 이면 전부.
 *
 * ⚠️ **닫아도 남는다.** 그게 이 기능의 요점이다 — 한 프로젝트를 파는 동안 매번 다시
 * 고르게 하면 아무도 안 쓴다.
 *
 * ⚠️ 남는 만큼 **눈에 보여야 한다.** 조용히 좁혀진 결과는 "왜 안 나오지"가 되고, 그건
 * 검색이 고장 난 것과 구별이 안 된다. 화면은 스코프를 항상 그리고 한 번에 풀 수 있게 한다.
 */
export const paletteScope = writable<string | null>(loadScope());

function loadScope(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(SCOPE_KEY);
    return raw && raw.trim() !== "" ? raw : null;
  } catch {
    return null;
  }
}

paletteScope.subscribe((v) => {
  if (typeof localStorage === "undefined") return;
  try {
    if (v) localStorage.setItem(SCOPE_KEY, v);
    else localStorage.removeItem(SCOPE_KEY);
  } catch {
    /* 무시 — 스코프를 못 저장한다고 검색이 죽으면 안 된다 */
  }
});

export function setPaletteScope(prefix: string | null): void {
  paletteScope.set(prefix);
}

// ─── 저장된 검색 ─────────────────────────────────────────────────────────────

/**
 * ⚠️ 판정(같은 검색인가 · 상한 · 파싱)은 전부 `savedSearch.ts` 에 있다. 여기는 store 와
 * 영속화만 한다 — 규칙이 두 곳에 있으면 갈린다.
 */
export const savedSearches = writable<SavedSearch[]>(loadSaved());

function loadSaved(): SavedSearch[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(SAVED_SEARCH_KEY);
    return parseSaved(raw ? JSON.parse(raw) : null);
  } catch {
    return [];
  }
}

savedSearches.subscribe((list) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SAVED_SEARCH_KEY, JSON.stringify(list));
  } catch {
    /* 무시 — 저장을 못 한다고 검색이 죽으면 안 된다 */
  }
});

export function saveSearch(entry: SavedSearch): void {
  savedSearches.update((l) => upsert(l, entry));
}

export function removeSavedSearch(entry: SavedSearch): void {
  savedSearches.update((l) => remove(l, entry));
}

/** 저장된 검색을 연다 — 모드·스코프까지 함께 세운다. */
export function applySavedSearch(entry: SavedSearch): void {
  setPaletteMode(entry.mode);
  paletteScope.set(entry.scope);
  paletteOpen.set(true);
}

/** 모드를 바꾸고, 순환 안의 모드면 기억한다. */
export function setPaletteMode(mode: PaletteMode): void {
  paletteHintMode.set(mode);
  if (isCycleMode(mode)) lastPaletteMode.set(mode);
}

export function openPalette(
  mode: PaletteMode = "all",
  intent: PaletteOpenIntent = "new-tab",
): void {
  setPaletteMode(mode);
  paletteIntent.set(intent);
  paletteOpen.set(true);
}

/** `⌘K` — 마지막으로 쓰던 모드로 연다. */
export function openPaletteAtLastMode(intent: PaletteOpenIntent = "new-tab"): void {
  openPalette(get(lastPaletteMode), intent);
}

export function closePalette(): void {
  paletteOpen.set(false);
}
