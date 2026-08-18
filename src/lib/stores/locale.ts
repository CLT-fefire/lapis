import { writable } from "svelte/store";
import { baseLocale, locales, overwriteGetLocale } from "$lib/paraglide/runtime.js";

export type Locale = (typeof locales)[number];
/** `system` = OS 언어를 따른다(저장 안 함). 나머지는 사용자가 고정한 값. */
export type LocaleMode = "system" | Locale;

/**
 * 사용자가 **명시적으로 고른** 로케일만 담는다. "system"이면 키 자체가 없다.
 *
 * ⚠️ Paraglide의 `localStorage` 전략(`PARAGLIDE_LOCALE`)을 쓰지 않는 이유가 여기 있다.
 * 그 전략은 첫 해소 때 **감지 결과까지 저장**해서, 사용자가 고른 적도 없는 값이 고정된다
 * → OS 언어를 바꿔도 안 따라온다. 여기서는 "고름"과 "감지됨"을 분리한다.
 */
const OVERRIDE_KEY = "lapis.locale";

function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (locales as readonly string[]).includes(v);
}

/** 사용자가 고정한 값. 없거나 알 수 없는 값이면 null. */
function readOverride(): Locale | null {
  if (typeof localStorage === "undefined") return null;
  const v = localStorage.getItem(OVERRIDE_KEY);
  return isLocale(v) ? v : null;
}

/**
 * OS 언어 → 지원 로케일. `navigator.languages`를 우선순위대로 훑어 처음 맞는 걸 쓴다.
 * 지역 첨자는 버린다(`ko-KR` → `ko`). 아무것도 안 맞으면 baseLocale(en).
 */
export function detectOsLocale(): Locale {
  const tags = typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]);
  for (const tag of tags) {
    const base = String(tag).toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return baseLocale as Locale;
}

/** 지금 적용할 로케일. 사용자 고정 > OS 언어 > baseLocale. */
export function resolveLocale(): Locale {
  return readOverride() ?? detectOsLocale();
}

// ⚠️ 메시지가 하나라도 그려지기 전에 걸려야 한다. 이 모듈을 import하는 것만으로 적용된다.
overwriteGetLocale(() => resolveLocale());

/** 설정 UI가 보여줄 값 — 시스템/ko/en. */
export const localeMode = writable<LocaleMode>(readOverride() ?? "system");

/**
 * 실제 적용 중인 로케일. **`+layout.svelte`의 `{#key}`가 이 값을 본다.**
 *
 * ⚠️ Paraglide 메시지 함수는 순수 함수라 Svelte 반응성 그래프에 없다 — 로케일만 바꾸면
 * DOM이 그대로다. Svelte 5는 세밀 갱신이라 **다른 상태를 건드려도 소용없고**, 표현식
 * 자체가 파괴·재생성돼야 한다. 그래서 이 store로 루트를 remount한다.
 * (근거: `docs/solutions/svelte-issues/paraglide-messages-are-not-reactive-20260818.md`)
 */
export const activeLocale = writable<Locale>(resolveLocale());

/** 언어 설정 적용. "system"이면 고정을 지우고 다시 OS 언어를 따른다. */
export function setLocaleMode(mode: LocaleMode): void {
  if (typeof localStorage !== "undefined") {
    if (mode === "system") localStorage.removeItem(OVERRIDE_KEY);
    else localStorage.setItem(OVERRIDE_KEY, mode);
  }
  localeMode.set(mode);
  activeLocale.set(resolveLocale());
}
