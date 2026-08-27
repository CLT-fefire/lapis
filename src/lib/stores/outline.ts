import { writable } from "svelte/store";
import { slugify, type HeadingInfo } from "$lib/markdownPlugins/headingAnchor";

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

/**
 * `[[노트#헤딩]]`의 앵커로 헤딩을 찾는다. 없으면 `null`.
 *
 * ⚠️ 사람이 쓰는 것은 slug가 아니라 **헤딩 글자 그대로**다(`#어떤 헤딩`). 그래서 같은
 * `slugify`를 통과시켜 비교한다 — 미리보기의 `id`를 만든 함수와 **같은 것**이어야
 * 하고, 두 벌이 되면 한쪽만 바뀌었을 때 링크가 조용히 아무 데도 안 간다.
 *
 * ⚠️ 못 찾으면 **아무거나 고르지 않는다.** 엉뚱한 곳으로 스크롤하는 것이 문서 맨
 * 위에 그냥 있는 것보다 나쁘다.
 */
export function findHeadingByAnchor(
  headings: readonly HeadingInfo[],
  anchor: string,
): HeadingInfo | null {
  const want = slugify(anchor);
  return headings.find((h) => h.slug === want) ?? null;
}

/**
 * 노트를 연 **뒤에** 스크롤할 헤딩. `jumpToWikilink`가 set, `+page.svelte`가 소비한다.
 *
 * ⚠️ 별도 store인 이유는 **순서** 때문이다. 앵커를 아는 시점(클릭)과 그 노트의 헤딩
 * 목록이 생기는 시점(파싱 후)이 다르다. 클릭 시점에 바로 찾으려 하면 아직 이전 노트의
 * 헤딩 목록을 보고 있어서, 우연히 같은 이름의 헤딩이 있으면 **안 넘어가고 제자리에서
 * 스크롤한다.**
 */
export const pendingHeadingAnchor = writable<string | null>(null);
