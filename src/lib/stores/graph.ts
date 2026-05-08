import { writable } from "svelte/store";

export const graphOpen = writable<boolean>(false);

export function openGraph(): void {
  graphOpen.set(true);
}

export function closeGraph(): void {
  graphOpen.set(false);
}

export function toggleGraph(): void {
  graphOpen.update((v) => !v);
}
