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
 * - 폴더: name이 query 포함 → **하위를 통째로** 포함. 자손만 매칭 → 필터 결과로 교체
 *
 * ⚠️ **폴더가 맞으면 그 안이 곧 찾던 것이다.** 예전엔 폴더 이름이 맞아도 children 을
 * 필터 결과(=빈 배열)로 갈아 끼워서, `plans` 를 치면 **빈 `plans/` 폴더 한 줄**이 떴다.
 * 게다가 `countMatches` 는 잎만 세므로 화면에는 "0 matches"라고 적혔다 — 줄은 보이는데
 * 개수는 0이라 **둘 중 하나가 거짓말**이었고, 에러는 없었다.
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
      const selfMatches = entry.name.toLowerCase().includes(q);
      // ⚠️ 폴더 이름이 맞으면 **자르지 않는다.** 그 안이 곧 찾던 것이다.
      if (selfMatches) {
        out.push(entry);
        continue;
      }
      const filteredChildren = entry.children ? filterImpl(entry.children, q) : [];
      if (filteredChildren.length > 0) {
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

/**
 * 매칭된 파일(leaf) path를 트리 표시 순서대로 flat 수집.
 * 키보드 ↑↓ 순회 + Enter 선택용. 폴더는 skip (필터 시 자동 펼침이라 활성 의미 없음).
 */
export function collectLeafPaths(entries: NoteEntry[]): string[] {
  const out: string[] = [];
  walkLeaves(entries, out);
  return out;
}

function walkLeaves(entries: NoteEntry[], out: string[]): void {
  for (const entry of entries) {
    if (entry.is_dir) {
      if (entry.children) walkLeaves(entry.children, out);
    } else {
      out.push(entry.path);
    }
  }
}

/**
 * 표시 가능한 row를 트리 표시 순서대로 평탄화. 가상 스크롤(`FileTree.svelte` windowing)이
 * DOM에 단일 flat list로 렌더하기 위한 데이터.
 *
 * - 폴더는 항상 row 1개 추가
 * - 폴더가 펼쳐졌는지는 `expanded.has(path)`이면 그 값, 아니면 `forceExpand` 따름
 *   → 필터 활성(`forceExpand=true`) 중에도 사용자가 caret 클릭해 폴더 접기 가능
 * - depth는 padding-left 계산용
 */
export interface FlatRow {
  entry: NoteEntry;
  depth: number;
}

export function flattenTree(
  entries: NoteEntry[],
  expanded: Map<string, boolean>,
  forceExpand: boolean,
): FlatRow[] {
  const out: FlatRow[] = [];
  walkFlat(entries, 0, expanded, forceExpand, out);
  return out;
}

function walkFlat(
  entries: NoteEntry[],
  depth: number,
  expanded: Map<string, boolean>,
  forceExpand: boolean,
  out: FlatRow[],
): void {
  for (const entry of entries) {
    out.push({ entry, depth });
    if (entry.is_dir && entry.children) {
      // expanded.has(path)이면 explicit 값(사용자 toggle 결과), 없으면 forceExpand
      const open = expanded.has(entry.path)
        ? expanded.get(entry.path)!
        : forceExpand;
      if (open) {
        walkFlat(entry.children, depth + 1, expanded, forceExpand, out);
      }
    }
  }
}
