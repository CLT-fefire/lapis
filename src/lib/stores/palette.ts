import { writable } from "svelte/store";
import type { PaletteMode } from "$lib/palette";

export const paletteOpen = writable<boolean>(false);
/**
 * 호환 모드 힌트. Cmd+P/Cmd+Shift+F로 열면 각각 "files"/"fulltext"로 설정 → prefix 입력
 * 무시하고 그 그룹만 표시. Cmd+K로 열면 "all"이고 prefix(`>`, `#`, `:`)에 따라 분기.
 */
export const paletteHintMode = writable<PaletteMode>("all");

/**
 * 팔레트에서 고른 노트를 **어느 탭에** 열지.
 * - `new-tab` (기본): 탭을 추가한다. ⌘K·⌘T 등 기존 경로 전부.
 * - `replace`: 활성 탭을 갈아끼운다. ⌘P(Quick File Open) 전용 — "잠깐 보기".
 */
export type PaletteOpenIntent = "new-tab" | "replace";

export const paletteIntent = writable<PaletteOpenIntent>("new-tab");

export function openPalette(
  mode: PaletteMode = "all",
  intent: PaletteOpenIntent = "new-tab",
): void {
  paletteHintMode.set(mode);
  paletteIntent.set(intent);
  paletteOpen.set(true);
}

export function closePalette(): void {
  paletteOpen.set(false);
}
