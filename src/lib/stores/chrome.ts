import { writable } from "svelte/store";
import { isMacPlatform } from "$lib/platform";

/**
 * 창 크롬 — **상단바가 타이틀바를 겸하는가**.
 *
 * 켜면 OS 장식을 끄고(`decorations: false`) 상단바가 그 자리를 쓴다. 끄면 네이티브
 * 타이틀바가 상단바 **위에** 그대로 남는다.
 *
 * ## ⚠️ 왜 `tauri.conf.json` 에 박지 않았나
 *
 * 설정 파일에 `decorations: false` 를 쓰면 그 값은 **창이 생길 때** 적용된다. 프런트가
 * 못 뜨는 상황(빌드 사고·JS 예외)에서도 장식 없는 창이 뜨는데, 그러면 창을 옮길 수도
 * 닫을 수도 없다 — 캡션 버튼을 그릴 주체가 죽어 있기 때문이다.
 *
 * 런타임에 끄면 **기본 상태가 안전한 쪽**이다: 프런트가 살아 있을 때만 크롬이 바뀐다.
 *
 * ## ⚠️ 이 파일의 어느 것도 이 머신에서 검증되지 않았다
 *
 * 네이티브 창을 띄우지 않으면 확인할 수 없다. 브라우저 프리뷰에서는 `getCurrentWindow`
 * 자체가 없어서 아래 함수들이 전부 조용히 no-op 이 된다 — 그게 의도다.
 */
export type ChromeMode = "custom" | "native";

export const CHROME_MODES = ["custom", "native"] as const;

const CHROME_KEY = "lapis.chrome";

export function normalizeChrome(v: unknown): ChromeMode {
  return v === "native" ? "native" : "custom";
}

export const chromeMode = writable<ChromeMode>("custom");

/**
 * 커스텀 크롬을 **실제로 적용할 수 있는 플랫폼인가**.
 *
 * ⚠️ **Windows 뿐이다.** macOS 에서 `setDecorations(false)` 는 신호등까지 없앤다 —
 * 그러면 창을 닫을 방법이 ⌘Q 밖에 안 남는다. macOS 가 원하는 것은 장식 제거가 아니라
 * `titleBarStyle: "Overlay"`(신호등은 남기고 타이틀바만 투명하게)인데, 그건
 * `tauri.conf.json` 의 **빌드 시점** 설정이라 런타임 스위치로 켜고 끌 수 없고,
 * 이 머신에서는 검증할 수도 없다.
 *
 * 그래서 macOS 는 3.0 에서 네이티브 타이틀바 그대로다. 설정의 스위치도 아무 일을 하지
 * 않는다 — 하지 않는 것을 할 수 있는 것처럼 보이게 두지 않는다.
 *
 * ## macOS 에서 이어서 할 때
 *
 * **미뤄 둔 것이지 안 하기로 한 것이 아니다.** 순서:
 *
 * 1. `src-tauri/tauri.macos.conf.json` 을 새로 만들어 `titleBarStyle: "Overlay"` 를 건다.
 *    ⚠️ 공용 `tauri.conf.json` 을 고치지 않는다 — Windows 산출물까지 같이 바뀐다.
 *    `tauri.windows.conf.json`(NSIS 전용)이 같은 이유로 이미 따로 있다.
 * 2. 상단바 왼쪽에 **신호등 자리 78px** 을 비운다. `Titlebar.svelte` 의 `.tb-left` 몫이다.
 * 3. 이 함수의 macOS 제외를 푼다. 설정의 "타이틀바" 행도 그때 같이 살아난다
 *    (`SettingsModal.svelte` 가 `chromeSwitchable()` 로 그 행을 가린다).
 * 4. `titlebarChrome.test.ts` 는 Windows 전제(46×40 캡션 버튼)를 고정하고 있다.
 *    macOS 는 캡션 버튼을 그리지 않으므로 그 가드가 플랫폼을 갈라야 한다.
 *
 * ⚠️ **손으로 봐야 하는 것** — 자동 검증이 원리적으로 못 본다:
 * 신호등과 상단바 컨트롤이 겹치지 않는가 · 전체화면에서 상단바가 어긋나지 않는가 ·
 * 드래그로 창이 움직이는가 · 설정에서 네이티브로 되돌리면 정상인가.
 */
export function chromeSwitchable(): boolean {
  return !isMacPlatform();
}

/** Windows 에서 커스텀 크롬일 때만 캡션 버튼을 그린다. */
export function needsCaptionButtons(mode: ChromeMode): boolean {
  return mode === "custom" && chromeSwitchable();
}

function applyBodyAttr(mode: ChromeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.chrome = mode;
}

/**
 * 실제 창에 반영한다.
 *
 * ⚠️ Tauri 밖(브라우저 프리뷰·테스트)에서는 조용히 지나간다. 여기서 던지면 앱이
 * 아니라 **개발 중 프리뷰가** 죽는다.
 */
async function applyToWindow(mode: ChromeMode): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  // ⚠️ macOS 에서는 아무것도 안 한다 — 위 `chromeSwitchable` 참조.
  if (!chromeSwitchable()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setDecorations(mode === "native");
  } catch (e) {
    // 권한이 없거나 플랫폼이 거부한 경우 — 네이티브 장식이 남는다. 그게 안전한 쪽이다.
    console.warn("setDecorations failed", e);
  }
}

export function setChromeMode(mode: ChromeMode): void {
  chromeMode.set(mode);
  applyBodyAttr(mode);
  void applyToWindow(mode);
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CHROME_KEY, mode);
  } catch {
    /* localStorage 사용 불가 — 무시 */
  }
}

/** 시동 시 1회. */
export function restoreChromeMode(): void {
  let raw: string | null = null;
  if (typeof localStorage !== "undefined") {
    try {
      raw = localStorage.getItem(CHROME_KEY);
    } catch {
      /* 무시 */
    }
  }
  const mode = normalizeChrome(raw);
  chromeMode.set(mode);
  applyBodyAttr(mode);
  void applyToWindow(mode);
}
