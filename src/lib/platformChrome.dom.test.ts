import { describe, it, expect, afterEach } from "vitest";
import { isMacPlatform } from "./platform";
import { normalizeChrome, chromeSwitchable, needsCaptionButtons } from "./stores/chrome";

/**
 * 플랫폼 판정과 창 크롬 — **두 머신에서 다르게 도는 것들.**
 *
 * ## 🔴 왜 덮어야 했나
 *
 * 이 저장소는 macOS 와 Windows 를 같이 겨냥하는데 **확인은 Windows 에서만** 한다.
 * 그래서 플랫폼으로 갈리는 판정은 **한쪽에서만 돌려 보고 양쪽을 믿는** 자리가 된다 —
 * 정확히 조용히 틀리기 좋은 모양이다. UA 를 바꿔 가며 재면 머신 없이도 양쪽을 볼 수 있다.
 *
 * ⚠️ 커스텀 타이틀바는 실제로 한 번 크게 틀렸었다(v3.0.1 에서 창이 드래그로 안 움직였다).
 */

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/120";

const original = navigator.userAgent;
const setUA = (ua: string) =>
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });

afterEach(() => setUA(original));

describe("플랫폼 판정", () => {
  it("macOS UA 를 mac 으로 본다", () => {
    setUA(MAC);
    expect(isMacPlatform()).toBe(true);
  });

  it("Windows UA 를 mac 이 아니라고 본다", () => {
    setUA(WIN);
    expect(isMacPlatform()).toBe(false);
  });

  /** ⚠️ `Mac OS X` 표기도 받는다 — UA 문자열은 브라우저마다 조금씩 다르다. */
  it("Mac OS X 표기도 잡는다", () => {
    setUA("something Mac OS X something");
    expect(isMacPlatform()).toBe(true);
  });

  it("알 수 없는 UA 는 mac 이 아니다", () => {
    setUA("Mozilla/5.0 (X11; Linux x86_64)");
    expect(isMacPlatform()).toBe(false);
  });
});

/**
 * 🔴 **커스텀 크롬은 Windows 에서만 갈아탈 수 있다.** macOS 는 `titleBarStyle` 이
 * 빌드 시점 설정이라 런타임 스위치가 원리적으로 안 된다 — 설정에 스위치를 그리면
 * 눌러도 아무 일이 안 나고, 그건 고장과 구별이 안 된다.
 */
describe("창 크롬", () => {
  it("Windows 에서는 갈아탈 수 있다", () => {
    setUA(WIN);
    expect(chromeSwitchable()).toBe(true);
  });

  it("macOS 에서는 갈아탈 수 없다", () => {
    setUA(MAC);
    expect(chromeSwitchable()).toBe(false);
  });

  describe("캡션 버튼", () => {
    it("Windows + 커스텀일 때만 그린다", () => {
      setUA(WIN);
      expect(needsCaptionButtons("custom")).toBe(true);
      expect(needsCaptionButtons("native"), "네이티브인데 버튼을 또 그렸다").toBe(false);
    });

    /** ⚠️ macOS 는 신호등이 OS 것이다. 우리가 그리면 **버튼이 두 벌**이 된다. */
    it("macOS 에서는 어느 모드든 안 그린다", () => {
      setUA(MAC);
      expect(needsCaptionButtons("custom")).toBe(false);
      expect(needsCaptionButtons("native")).toBe(false);
    });
  });
});

/**
 * 저장된 값 → 모드. ⚠️ 손상되거나 낡은 값이 와도 앱은 떠야 한다.
 * 기본이 `custom` 인 것이 계약이다 — 모르면 우리 크롬으로 간다.
 */
describe("저장된 값 읽기", () => {
  it("native 만 native 다", () => {
    expect(normalizeChrome("native")).toBe("native");
  });

  it("나머지는 전부 custom", () => {
    for (const v of ["custom", "", "무언가", null, undefined, 0, 42, {}, []]) {
      expect(normalizeChrome(v)).toBe("custom");
    }
  });
});
