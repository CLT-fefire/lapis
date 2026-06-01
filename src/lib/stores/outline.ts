import { writable } from "svelte/store";
import type { HeadingInfo } from "$lib/markdownPlugins/headingAnchor";

/** 현재 노트의 헤딩 목록 — +page.svelte가 parsed.headings로 갱신. */
export const outlineHeadings = writable<HeadingInfo[]>([]);

/** 프리뷰 스크롤 위치 기준 현재 활성 헤딩 slug (scroll-spy). */
export const activeHeadingSlug = writable<string | null>(null);

/**
 * 헤딩 점프 요청. OutlinePanel이 set, +page.svelte가 소비
 * (에디터 라인 점프 + 프리뷰 스크롤). nonce로 같은 헤딩 반복 클릭도 재발화.
 */
export const headingJumpRequest = writable<{
  heading: HeadingInfo;
  nonce: number;
} | null>(null);

let nonce = 0;
export function jumpToHeading(heading: HeadingInfo): void {
  nonce += 1;
  headingJumpRequest.set({ heading, nonce });
}
