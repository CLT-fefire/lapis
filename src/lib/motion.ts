import { cubicOut } from "svelte/easing";

/**
 * 전환(등장/퇴장) 모션의 단일 소스 (2026-08-05 PR-8).
 *
 * ⚠️ **왜 헬퍼가 필요한가** — app.css의 `@media (prefers-reduced-motion: reduce)`는
 * CSS transition/animation만 무력화한다. Svelte transition은 JS가 duration을 제어하므로
 * 그 규칙에 걸리지 않는다. 여기서 matchMedia를 직접 보고 duration을 0으로 떨어뜨린다.
 *
 * 값은 app.css의 --dur-* 척도와 맞춘다(JS에서 CSS 변수를 읽는 비용을 피하려 상수로 둠).
 * 한쪽만 바꾸면 CSS 전환과 JS 전환의 속도가 어긋나므로 함께 고칠 것.
 */
export const MOTION_FAST = 100; // --dur-fast
export const MOTION_BASE = 150; // --dur-base
export const MOTION_SLOW = 200; // --dur-slow

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** reduced-motion이면 0, 아니면 그대로. 모든 Svelte transition duration은 이걸 거친다. */
export function dur(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}

/** 모달·팔레트 backdrop — fade 전용. 카드보다 살짝 빠르게 빠진다. */
export function backdropFade() {
  return { duration: dur(MOTION_FAST) };
}

/**
 * 모달 카드 — scale+fade "pop". Discord 모달의 어휘(작게 시작해 제자리로).
 * start를 0.96보다 낮추면 과장돼 보이므로 이 값을 유지할 것.
 */
export function cardPop() {
  return { duration: dur(MOTION_BASE), start: 0.96, easing: cubicOut, opacity: 0 };
}

/**
 * 드롭다운·컨텍스트 메뉴 — 더 빠르고 더 작게 시작한다.
 * 자라나는 방향은 각 컴포넌트가 CSS `transform-origin`으로 정한다(트리거 쪽에서 열려야
 * 자연스럽다).
 */
export function menuPop() {
  return { duration: dur(MOTION_FAST), start: 0.95, easing: cubicOut, opacity: 0 };
}

/**
 * 아코디언 섹션 콘텐츠 — 위에서 살짝 내려오며 나타난다(fly).
 *
 * ⚠️ **slide를 쓸 수 없다.** SidebarSection의 `.body`는 `flex: 1`이라 height가 flex로
 * 결정되고, slide가 인라인으로 거는 height는 무시된다. 높이 변화 자체는 즉시 일어나고
 * 여기서는 **내용의 등장**만 다룬다 — chevron 회전(CSS)과 합쳐져 "펼쳐진다"로 읽힌다.
 */
export function sectionReveal() {
  return { duration: dur(MOTION_BASE), y: -6, easing: cubicOut };
}

/**
 * 탭 칩 추가/제거 — 가로로 늘어나며 등장.
 *
 * 탭 전환(다른 노트 열기)에는 **모션을 두지 않는다**. 하루에 수백 번 반복하는 조작이라
 * 매 전환이 곧 대기 시간이 되고, 읽기 시작이 그만큼 늦어진다. 여기는 "칩이 생기고
 * 사라지는" 구조 변화만 다룬다.
 */
export function tabChip() {
  return { duration: dur(MOTION_FAST), axis: "x" as const, easing: cubicOut };
}
