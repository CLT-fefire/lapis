import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import AlertBanner from "./AlertBanner.svelte";
import { alerts, pushAlert, clearAlerts } from "$lib/stores/alerts";

/**
 * 실패 배너의 **화면**.
 *
 * ## ⚠️ 스토어가 초록이어도 화면은 빌 수 있다
 *
 * `stores/alerts.test.ts` 가 올리기·내리기·상한을 전부 덮고 있었지만, 그 값을 **그리는
 * 쪽**은 아무도 안 봤다. 이 저장소에서 반복된 실패가 정확히 그 모양이다 — 순수 함수는
 * 초록인데 화면은 그대로고, 에러는 안 난다.
 *
 * 이 배너는 특히 그렇다. **되돌릴 수 없는 쓰기가 깨졌을 때만** 뜨므로 평소엔 보이지
 * 않고, 정작 떠야 할 순간에 안 뜨면 그 사실을 알 방법이 없다.
 */

let target: HTMLElement;
let app: Record<string, unknown> | null = null;

beforeEach(() => {
  clearAlerts();
  document.body.replaceChildren();
  target = document.createElement("div");
  document.body.appendChild(target);
});

afterEach(() => {
  if (app) void unmount(app);
  app = null;
  clearAlerts();
});

function render(): void {
  app = mount(AlertBanner, { target }) as Record<string, unknown>;
  flushSync();
}

const banner = () => target.querySelector<HTMLElement>('[data-lapis="alerts"]');
const rows = () => [...target.querySelectorAll<HTMLElement>(".alert")];

describe("빌 때", () => {
  /** ⚠️ 경고가 없을 때 **자리를 차지하면 안 된다** — 상태바 위에 늘 붙어 있는 곳이다. */
  it("경고가 없으면 아무것도 안 그린다", () => {
    render();
    expect(banner()).toBeNull();
  });
});

describe("뜰 때", () => {
  it("메시지를 그린다", () => {
    pushAlert("rewrite-failed", "인용 갱신 실패");
    render();
    expect(banner()).not.toBeNull();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("인용 갱신 실패");
  });

  /** 보조기술이 끼어들 수 있어야 한다 — 조용히 나타나면 못 본다. */
  it("role=alert 를 단다", () => {
    pushAlert("k", "실패");
    render();
    expect(banner()?.getAttribute("role")).toBe("alert");
  });

  it("여러 건을 전부 그린다", () => {
    pushAlert("a", "하나");
    pushAlert("b", "둘");
    render();
    expect(rows()).toHaveLength(2);
  });

  /**
   * ⚠️ **자세한 내용은 접혀 있어야 한다.** 예외 문자열이 첫 줄에 있으면 정작 무엇이
   * 실패했는지가 안 읽힌다 — 컴포넌트 주석이 그렇게 못 박고 있다.
   */
  it("자세한 내용은 접혀 있다", () => {
    pushAlert("k", "실패", "Error: EACCES /경로/노트.md");
    render();
    expect(target.querySelector(".detail"), "펼치기 전에 이미 보인다").toBeNull();
    expect(target.querySelector(".more"), "펼치는 버튼이 없다").not.toBeNull();
  });

  it("눌러서 펼치고 다시 접는다", () => {
    pushAlert("k", "실패", "Error: EACCES");
    render();
    const more = target.querySelector<HTMLButtonElement>(".more")!;

    more.click();
    flushSync();
    expect(target.querySelector(".detail")?.textContent).toContain("EACCES");

    more.click();
    flushSync();
    expect(target.querySelector(".detail")).toBeNull();
  });

  /** detail 이 없으면 펼칠 것도 없다 — 빈 버튼을 두면 눌러도 아무 일이 없다. */
  it("자세한 내용이 없으면 펼치기 버튼도 없다", () => {
    pushAlert("k", "실패");
    render();
    expect(target.querySelector(".more")).toBeNull();
  });
});

describe("닫을 때", () => {
  /**
   * 🔴 **사용자가 닫아야만 사라진다.** 토스트로 만들면 자리를 비운 사이에 지나가 버리고,
   * 그러면 "이름은 바뀌었는데 인용은 안 바뀐" 상태를 영영 모른다.
   */
  it("닫기 버튼이 그 건만 지운다", () => {
    pushAlert("a", "하나");
    pushAlert("b", "둘");
    render();
    expect(rows()).toHaveLength(2);

    const close = rows()[0].querySelector<HTMLButtonElement>(".close")!;
    close.click();
    flushSync();

    expect(rows()).toHaveLength(1);
    expect(alerts).toBeDefined();
  });

  /** 닫기 버튼의 이름이 기호나 빈 값이면 낭독기가 못 읽는다 — `modalCloseLabel` 과 같은 규칙. */
  it("닫기 버튼에 읽을 수 있는 이름이 있다", () => {
    pushAlert("k", "실패");
    render();
    const label = rows()[0].querySelector(".close")?.getAttribute("aria-label") ?? "";
    expect(label).not.toBe("");
    expect(/[\p{L}\p{N}]/u.test(label), `기호만으로 된 이름: "${label}"`).toBe(true);
  });

  it("마지막 하나를 닫으면 배너가 사라진다", () => {
    pushAlert("k", "실패");
    render();
    rows()[0].querySelector<HTMLButtonElement>(".close")!.click();
    flushSync();
    expect(banner()).toBeNull();
  });
});
