import { writable } from "svelte/store";

/**
 * 끊긴 링크 감사 화면의 **열림 상태만** 담는다.
 *
 * 판정은 전부 `$lib/brokenLinks`(순수)에 있다. 결과를 여기 캐시하지 않는 것은 의도다 —
 * vault가 바뀌면 즉시 낡은 값이 되는데, 그 무효화를 store에 또 하나 두면 인덱스 재빌드
 * 경로와 어긋날 여지만 늘어난다. **열 때마다 인덱스에서 새로 뽑는다**(19,000 노트 순회는
 * 한 번이면 충분히 빠르고, 여는 건 드문 동작이다).
 */
export const brokenLinksOpen = writable<boolean>(false);

export function openBrokenLinks(): void {
  brokenLinksOpen.set(true);
}

export function closeBrokenLinks(): void {
  brokenLinksOpen.set(false);
}
