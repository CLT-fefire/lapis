/**
 * 실행 플랫폼 판정.
 *
 * ⚠️ **단축키 매칭에는 쓰지 않는다.** `keymap.ts`는 이미 `metaKey || ctrlKey`로 양쪽을
 * 받으므로 플랫폼을 몰라도 되고, 플랫폼 분기를 넣으면 테스트가 환경에 의존하게 된다.
 * 여기서 갈리는 건 **사람에게 보여줄 표기**뿐이다(⌘N ↔ Ctrl+N, Finder ↔ 탐색기).
 *
 * `@tauri-apps/plugin-os`를 새로 물지 않는다 — 필요한 정보가 "mac이냐" 한 비트인데
 * 그 플러그인은 async라 라벨 계산이 전부 비동기로 번진다. webview UA로 충분하다:
 * macOS는 WKWebView(`Macintosh`), Windows는 WebView2(`Windows NT`)를 쓴다.
 */

/** navigator가 없는 환경(vitest node 프로젝트)에서 쓸 기본값. 기존 표기를 유지한다. */
const FALLBACK_IS_MAC = true;

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return FALLBACK_IS_MAC;
  return /Macintosh|Mac OS X/i.test(navigator.userAgent);
}
