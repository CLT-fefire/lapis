import { writable } from "svelte/store";

/**
 * Phase A-1 — Files 탭 그룹핑 렌즈 선택 상태.
 * `null` = 폴더 트리(기본). 문자열 = 그 frontmatter 필드로 그룹핑.
 * localStorage 영속(전역 — status/phase 등 공통 축이라 vault 무관).
 */
const KEY = "lapis.grouping-field";

function load(): string | null {
  try {
    return localStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
}

export const groupingField = writable<string | null>(load());

groupingField.subscribe((value) => {
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    /* vitest 등 localStorage 미지원 환경 무시 */
  }
});

export function setGroupingField(field: string | null): void {
  groupingField.set(field);
}
