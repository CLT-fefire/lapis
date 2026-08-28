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

/** 위생 화면의 탭 id — 모달과 팔레트가 공유한다. */
export type HygieneTab = "broken" | "orphans" | "tags" | "unlinked" | "props" | "tasks" | "changes";

/**
 * **열 때 어느 탭으로 갈지.** 팔레트가 세우고 모달이 읽는다.
 *
 * ⚠️ 감사가 다섯이 되고 나서는 "속성 위생을 보자"에 클릭이 셋 든다(팔레트 → 모달 →
 * 탭). 열림 상태만 두면 팔레트가 목적지를 말할 방법이 없다.
 *
 * ⚠️ **결과를 캐시하는 게 아니다.** 위 주석의 원칙은 그대로다 — 이건 목적지 하나뿐이고,
 * 모달이 열릴 때 한 번 읽고 만다.
 */
export const hygieneInitialTab = writable<HygieneTab>("broken");

export function openBrokenLinks(tab: HygieneTab = "broken"): void {
  hygieneInitialTab.set(tab);
  brokenLinksOpen.set(true);
}

export function closeBrokenLinks(): void {
  brokenLinksOpen.set(false);
}
