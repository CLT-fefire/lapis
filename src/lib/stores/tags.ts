import { writable } from "svelte/store";
import type { LinkInfo } from "$lib/tauri/notes";
import { showView } from "./sidebar";
import { expandSidebar, expandContext } from "./layout";
import { ensureContextSectionOpen } from "./context";

/**
 * 태그 인덱스 — leaf(정확) 매칭과 prefix(계층) 매칭을 모두 지원.
 *
 * SharedDocs 4키 스키마 §2.3 — nested tags(`feature/bubble/creation`)에서:
 * - leaf: 정확 매칭. `feature/bubble/creation` 만 매칭
 * - prefix: 계층 매칭. `feature`로 검색하면 `feature/*` 모든 노트 매칭
 */
export interface TagIndex {
  // leaf 키 (정확 태그) → 그 태그를 가진 노트 path 집합
  byTag: Map<string, Set<string>>;
  // prefix 키 (예: 'feature', 'feature/bubble') → 그 prefix 하위 모든 노트
  byPrefix: Map<string, Set<string>>;
  // tag(소문자) → 표시용 원본 케이스 (가장 자주 쓰인 형태)
  display: Map<string, string>;
  // tag(소문자) → 노트 수
  counts: Map<string, number>;
  // prefix(소문자) → 노트 수 (해당 prefix 하위 unique 노트 수)
  prefixCounts: Map<string, number>;
  // root prefix → 직계 자식 태그/sub-prefix 목록 (UI 트리 렌더용)
  // 예: 'feature' → ['feature/bubble-creation', 'feature/artist-invite']
  prefixChildren: Map<string, string[]>;
  // 정렬된 root prefix 목록 (count 내림차순)
  rootPrefixes: string[];
  // prefix 없는 평면 태그 (count 내림차순)
  flatTags: string[];
  // 전체 leaf 태그 (count 내림차순) — 호환성 위해 유지
  sortedTags: string[];
}

export type SidebarTab = "files" | "outline" | "tags" | "filters" | "favorites";
export type SelectedTagKind = "leaf" | "prefix";

export const tagIndex = writable<TagIndex | null>(null);
/** 선택된 태그 키 — leaf면 정확 매칭, prefix면 계층 매칭 */
export const selectedTag = writable<string | null>(null);
export const selectedTagKind = writable<SelectedTagKind>("leaf");
export const sidebarTab = writable<SidebarTab>("files");
/** TagPanel 트리에서 어떤 prefix 그룹이 펼쳐져 있는지 */
export const expandedPrefixes = writable<Set<string>>(new Set());

export function buildTagIndex(infos: LinkInfo[]): TagIndex {
  const byTag = new Map<string, Set<string>>();
  const byPrefix = new Map<string, Set<string>>();
  const displayCount = new Map<string, Map<string, number>>();
  const prefixChildrenSet = new Map<string, Set<string>>();
  const flatSet = new Set<string>();

  function addToPathSet(map: Map<string, Set<string>>, key: string, path: string) {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(path);
  }

  for (const info of infos) {
    for (const raw of info.tags) {
      const tag = raw.trim();
      if (!tag) continue;
      const key = tag.toLowerCase();

      // 1) leaf 색인
      addToPathSet(byTag, key, info.source_path);

      // 2) 표시 케이스 카운팅
      let casings = displayCount.get(key);
      if (!casings) {
        casings = new Map();
        displayCount.set(key, casings);
      }
      casings.set(tag, (casings.get(tag) ?? 0) + 1);

      // 3) prefix 색인 — `feature/bubble/creation` →
      //    `feature`, `feature/bubble`, **그리고 `feature/bubble/creation` 자신**.
      //
      // ⚠️ **자기 자신을 넣는 것이 핵심이다.** MCP 의 태그 질의가
      //    `n === t || n.startsWith(t + "/")` — **정확 일치 ∪ 하위**다. 앱이 자기 자신을
      //    빼면 같은 태그를 물었을 때 **앱과 MCP 가 다른 집합**을 낸다. 정확히 태그된
      //    노트가 앱의 접두사 선택에서만 사라지고, 에러는 없다.
      const parts = key.split("/");
      for (let i = 0; i < parts.length; i++) {
        const prefix = parts.slice(0, i + 1).join("/");
        addToPathSet(byPrefix, prefix, info.source_path);
        // ⚠️ **모든 단계의 직계 자식**을 담는다. 예전엔 root 의 1-depth 만 담아서
        //    3단계 태그는 칩이 아예 없었고, 그 위 2단계가 정확 태그를 겸하면
        //    `isSubPrefix` 가 false 가 되어 **트리에서 닿을 수 없었다.**
        if (i + 1 < parts.length) {
          const child = parts.slice(0, i + 2).join("/");
          let children = prefixChildrenSet.get(prefix);
          if (!children) {
            children = new Set();
            prefixChildrenSet.set(prefix, children);
          }
          children.add(child);
        }
      }
      if (parts.length === 1) flatSet.add(key);
    }
  }

  // display 결정 — 가장 자주 쓰인 케이스
  const display = new Map<string, string>();
  for (const [key, casings] of displayCount) {
    let best = "";
    let bestCount = -1;
    for (const [casing, count] of casings) {
      if (count > bestCount) {
        best = casing;
        bestCount = count;
      }
    }
    display.set(key, best);
  }

  const counts = new Map<string, number>();
  for (const [key, paths] of byTag) counts.set(key, paths.size);

  const prefixCounts = new Map<string, number>();
  for (const [key, paths] of byPrefix) prefixCounts.set(key, paths.size);

  // 트리 렌더용 정렬
  const prefixChildren = new Map<string, string[]>();
  for (const [root, children] of prefixChildrenSet) {
    const sorted = [...children].sort((a, b) => {
      const ca = counts.get(a) ?? prefixCounts.get(a) ?? 0;
      const cb = counts.get(b) ?? prefixCounts.get(b) ?? 0;
      return cb - ca || a.localeCompare(b);
    });
    prefixChildren.set(root, sorted);
  }

  const rootPrefixes = [...prefixChildrenSet.keys()].sort((a, b) => {
    const ca = prefixCounts.get(a) ?? 0;
    const cb = prefixCounts.get(b) ?? 0;
    return cb - ca || a.localeCompare(b);
  });

  const flatTags = [...flatSet].sort((a, b) => {
    const ca = counts.get(a) ?? 0;
    const cb = counts.get(b) ?? 0;
    return cb - ca || a.localeCompare(b);
  });

  const sortedTags = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);

  return {
    byTag,
    byPrefix,
    display,
    counts,
    prefixCounts,
    prefixChildren,
    rootPrefixes,
    flatTags,
    sortedTags,
  };
}

/**
 * leaf 또는 prefix 태그 선택.
 * - kind 'leaf': 정확 매칭 (예: 'feature/bubble-creation' 만)
 * - kind 'prefix': 계층 매칭 (예: 'feature' → 'feature/*' 모두)
 */
export function selectTag(tag: string | null, kind: SelectedTagKind = "leaf"): void {
  selectedTag.set(tag ? tag.toLowerCase() : null);
  selectedTagKind.set(kind);
}

// 구 가로 탭(sidebarTab)을 세로 아코디언(sidebar.ts)으로 리다이렉트 — 호출처 무변경.
// 사이드바가 접혀(레일만) 있으면 펼치고, 태그 뷰로 간다.
export function showTagsTab(): void {
  expandSidebar();
  showView("tags");
}

export function showFilesTab(): void {
  expandSidebar();
  showView("files");
}

/** 목차는 2026-08-05(PR-4)부터 우측 컨텍스트 패널 소속 — ⌘⇧O도 그쪽을 연다. */
export function showOutlineTab(): void {
  expandContext();
  ensureContextSectionOpen("outline");
}

export function showFavoritesTab(): void {
  expandSidebar();
  showView("favorites");
}

export function clearTagIndex(): void {
  tagIndex.set(null);
  selectedTag.set(null);
  selectedTagKind.set("leaf");
  expandedPrefixes.set(new Set());
}

export function togglePrefix(prefix: string): void {
  expandedPrefixes.update((set) => {
    const next = new Set(set);
    if (next.has(prefix)) next.delete(prefix);
    else next.add(prefix);
    return next;
  });
}
