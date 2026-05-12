import { writable } from "svelte/store";

export const memorySearchOpen = writable<boolean>(false);

export function openMemorySearch(): void {
  memorySearchOpen.set(true);
}

export function closeMemorySearch(): void {
  memorySearchOpen.set(false);
}
