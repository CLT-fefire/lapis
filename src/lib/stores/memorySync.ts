import { writable } from "svelte/store";

export const memorySyncOpen = writable<boolean>(false);

export function openMemorySync(): void {
  memorySyncOpen.set(true);
}

export function closeMemorySync(): void {
  memorySyncOpen.set(false);
}
