import { get, writable } from "svelte/store";
import { CYCLE_MODES, type PaletteMode } from "$lib/palette";

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
