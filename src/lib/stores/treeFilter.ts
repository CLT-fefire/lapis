import { writable } from "svelte/store";
import type { NoteEntry } from "$lib/tauri/notes";

/**
 * 사이드바 파일 트리 필터 — 입력 query를 store에 보관. 빈 문자열이면 필터 미적용.
 * CommandPalette ⌘P/⌘K의 fuzzy file open과 별개 — 트리 그 자리에서 펼친 채 필터링.
 *
 * 매칭은 case-insensitive substring on `entry.name` (파일 stem 또는 폴더 이름).
 * 매칭된 leaf의 모든 상위 폴더는 자동 표시 + FileTree에서 `forceExpand`로 강제 펼침.
 */
export const treeFilterQuery = writable<string>("");

export function clearTreeFilter(): void {
  treeFilterQuery.set("");
}

/**
 * 트리를 query로 재귀적으로 필터링. 매칭 시 부모 체인까지 결과에 포함.
 * - 파일: name이 query 포함 시 포함
 * - 폴더: name이 query 포함 OR 자손 매칭 있을 때 포함 (children도 필터 결과로 교체)
 *
 * `?:` query 빈 문자열이면 원본 그대로 반환 (zero-cost).
 */
export function filterEntries(entries: NoteEntry[], query: string): NoteEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return filterImpl(entries, q);
}

function filterImpl(entries: NoteEntry[], q: string): NoteEntry[] {
  const out: NoteEntry[] = [];
  for (const entry of entries) {
    if (entry.is_dir) {
      const filteredChildren = entry.children ? filterImpl(entry.children, q) : [];
      const selfMatches = entry.name.toLowerCase().includes(q);
      if (selfMatches || filteredChildren.length > 0) {
        out.push({ ...entry, children: filteredChildren });
      }
    } else if (entry.name.toLowerCase().includes(q)) {
      out.push(entry);
    }
  }
  return out;
}

/** 필터 적용 후 leaf(파일) 카운트 — UI에 "N matches" 표시용. */
export function countMatches(entries: NoteEntry[]): number {
  let n = 0;
  for (const entry of entries) {
    if (!entry.is_dir) {
      n++;
    } else if (entry.children) {
      n += countMatches(entry.children);
    }
  }
  return n;
}
