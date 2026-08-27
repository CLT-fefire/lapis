import { writable } from "svelte/store";

/**
 * 애니메이션 설정 — **3단**.
 *
 * - `system`  : OS 의 "동작 줄이기"를 따른다(기본).
 * - `minimal` : OS 가 뭐라 하든 전환을 끈다.
 * - `full`    : OS 가 줄이라고 해도 전부 켠다.
 *
 * ## ⚠️ 왜 OS 설정만으로 부족한가
 *
 * `prefers-reduced-motion` 은 **시스템 전역**이다. 이 앱에서만 모션이 거슬리는 사람과,
 * 시스템에서는 줄여 뒀지만 여기서는 보고 싶은 사람이 각각 있다. 시스템만 보면 둘 다
 * 설정할 방법이 없다.
 *
 * ## ⚠️ 두 곳이 같은 값을 읽어야 한다
 *
 * CSS 는 `<html data-motion>` 을, Svelte transition 은 `motion.ts` 의 `dur()` 를 지난다.
 * 한쪽만 반영하면 **같은 동작이 CSS 로 그려질 때와 JS 로 그려질 때 다르게** 움직인다 —
 * 그건 버그처럼 안 보이고 그냥 어색하게 보인다.
 *
 * ⚠️ 스피너·진행 바는 여기서 다루지 않는다. "작업 중"을 알리는 **기능** 요소라
 * `minimal` 에서도 돌아야 한다(`app.css` 의 복원 목록).
 */
export type MotionPref = "system" | "minimal" | "full";

export const MOTION_PREFS = ["system", "minimal", "full"] as const;

const MOTION_KEY = "lapis.motion";

export function normalizeMotionPref(v: unknown): MotionPref {
  return (MOTION_PREFS as readonly unknown[]).includes(v) ? (v as MotionPref) : "system";
}

export const motionPref = writable<MotionPref>("system");

function applyMotionPref(pref: MotionPref): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.motion = pref;
}

export function setMotionPref(pref: MotionPref): void {
  motionPref.set(pref);
  applyMotionPref(pref);
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(MOTION_KEY, pref);
  } catch {
    /* localStorage 사용 불가 — 무시 */
  }
}

/** 시동 시 1회. `app.html` 의 인라인 스크립트가 first paint 전에 같은 일을 한다. */
export function restoreMotionPref(): void {
  if (typeof localStorage === "undefined") return;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(MOTION_KEY);
  } catch {
    /* 무시 */
  }
  const pref = normalizeMotionPref(raw);
  motionPref.set(pref);
  applyMotionPref(pref);
}

/**
 * 지금 모션을 줄여야 하나 — **`motion.ts` 의 `dur()` 가 이 함수를 쓴다.**
 *
 * ⚠️ store 가 아니라 DOM 속성을 읽는다. `dur()` 는 transition 이 시작하는 **그 순간**
 * 호출되는 평범한 함수라 구독을 걸 자리가 없고, `app.html` 이 first paint 전에 이미
 * 속성을 박아 두므로 store 보다 이쪽이 항상 먼저 맞는다.
 */
export function shouldReduceMotion(systemReduced: boolean): boolean {
  const pref =
    typeof document === "undefined"
      ? "system"
      : normalizeMotionPref(document.documentElement.dataset.motion);
  if (pref === "minimal") return true;
  if (pref === "full") return false;
  return systemReduced;
}
