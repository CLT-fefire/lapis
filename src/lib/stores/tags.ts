import { writable } from "svelte/store";
import { type TagIndex } from "$lib/tagIndex";
import { showView } from "./sidebar";
import { expandSidebar, expandContext } from "./layout";
import { ensureContextSectionOpen } from "./context";


export type SidebarTab = "files" | "outline" | "tags" | "filters" | "favorites";
export type SelectedTagKind = "leaf" | "prefix";

export const tagIndex = writable<TagIndex | null>(null);
/** 선택된 태그 키 — leaf면 정확 매칭, prefix면 계층 매칭 */
export const selectedTag = writable<string | null>(null);
export const selectedTagKind = writable<SelectedTagKind>("leaf");
export const sidebarTab = writable<SidebarTab>("files");
/** TagPanel 트리에서 어떤 prefix 그룹이 펼쳐져 있는지 */
export const expandedPrefixes = writable<Set<string>>(new Set());


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
