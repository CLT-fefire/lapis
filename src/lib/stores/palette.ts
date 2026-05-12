import { writable } from "svelte/store";
import type { PaletteMode } from "$lib/palette";

export const paletteOpen = writable<boolean>(false);
/**
 * 호환 모드 힌트. Cmd+P/Cmd+Shift+F로 열면 각각 "files"/"fulltext"로 설정 → prefix 입력
 * 무시하고 그 그룹만 표시. Cmd+K로 열면 "all"이고 prefix(`>`, `#`, `:`)에 따라 분기.
 */
export const paletteHintMode = writable<PaletteMode>("all");

export function openPalette(mode: PaletteMode = "all"): void {
  paletteHintMode.set(mode);
  paletteOpen.set(true);
}

export function closePalette(): void {
  paletteOpen.set(false);
}
