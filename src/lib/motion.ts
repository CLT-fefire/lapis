import { cubicOut } from "svelte/easing";
import { shouldReduceMotion } from "$lib/stores/motionPref";

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
// ⚠️ **CSS 와 짝이다.** `app.css` 의 `--dur-1..4` 와 같은 값이어야 한다 — 한쪽만 바꾸면
//    같은 동작이 CSS 로 그려질 때와 Svelte transition 으로 그려질 때 속도가 어긋난다.
//    옛 이름(`--dur-fast/base/slow`)은 CSS 에 별칭으로 한 릴리스만 남아 있다.
export const MOTION_FAST = 90; // --dur-1
export const MOTION_BASE = 140; // --dur-2
export const MOTION_SLOW = 220; // --dur-3
export const MOTION_XSLOW = 320; // --dur-4

/**
 * 척도에 없는 값들 — 모션 명세가 이유와 함께 따로 정한 것만 둔다.
 *
 * ⚠️ 새 상수를 여기 늘리기 전에 `--dur-*` 넷 중 하나로 되는지 본다. 척도가 늘어나면
 * "왜 이 값인가"를 아무도 답할 수 없게 된다.
 */
/** 스크림 — 카드보다 먼저 깔리고 카드보다 오래 남지 않는다. */
export const MOTION_SCRIM = 120;
/** 탭 밑줄 · 읽기↔편집 세그먼트 슬라이드. */
export const MOTION_SLIDE = 180;
/** 검색 결과 행 등장. stagger 24ms 와 짝이다. */
export const MOTION_ROW = 160;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * reduced-motion이면 0, 아니면 그대로. 모든 Svelte transition duration은 이걸 거친다.
 *
 * ⚠️ **설정(`data-motion`)이 시스템보다 세다.** 시스템만 보면 "이 앱에서만 줄이고 싶다"와
 * "시스템에서는 줄여 뒀지만 여기서는 보고 싶다"를 둘 다 표현할 수 없다.
 */
export function dur(ms: number): number {
  return shouldReduceMotion(prefersReducedMotion()) ? 0 : ms;
}

/** 모달·팔레트 스크림 — fade 전용. 카드보다 먼저 깔린다. */
export function backdropFade() {
  return { duration: dur(MOTION_SCRIM) };
}

/**
 * 모달 카드 — scale + y + fade.
 *
 * ⚠️ **등장과 퇴장의 길이가 다르다**(220 / 140). 닫는 동작이 기다림이 되면 안 된다.
 * Svelte 의 `transition:` 하나로는 양방향 길이를 못 가르므로 호출부가 `in:`/`out:` 을
 * 따로 쓴다.
 *
 * ⚠️ `scale` 내장 전환을 못 쓴다 — y 이동이 필요한데 그쪽은 배율만 다룬다. 여기서
 * 직접 `transform` 을 만든다.
 */
interface CardConfig {
  duration: number;
  easing: (t: number) => number;
  css: (t: number) => string;
}

/**
 * ⚠️ Svelte 는 전환 함수를 `(node, params)` 로 부른다. 인자를 안 받게 쓰면
 * `Expected 0 arguments, but got 1` 로 **컴파일 단계에서** 걸린다 — 다행히 조용하지 않다.
 * 여기서는 노드가 필요 없지만 시그니처는 맞춰 둔다.
 */
function cardMotion(ms: number, fromY: number, fromScale: number) {
  return (_node?: Element, _params?: unknown): CardConfig => ({
    duration: dur(ms),
    easing: cubicOut,
    css: (t: number) =>
      `opacity: ${t}; transform: translateY(${(1 - t) * fromY}px) scale(${fromScale + (1 - fromScale) * t})`,
  });
}

/** 등장 — 220ms, 위에서 8px 내려오며 .97 → 1. */
export const cardIn = cardMotion(MOTION_SLOW, -8, 0.97);

/** 퇴장 — 140ms, 더 짧은 거리로 되돌아간다. */
export const cardOut = cardMotion(MOTION_BASE, -4, 0.985);

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
