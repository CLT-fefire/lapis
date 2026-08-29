import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount } from "svelte";
import Host from "./testHarness/ModalShellHost.svelte";
import { installAnimateStub, flushFrames } from "./testHarness/animateStub";

/**
 * 모달 껍데기 — **떠 있는 동안 바깥이 조용해야 한다.**
 *
 * ## 🔴 왜 이 파일이 생겼나
 *
 * 링크 갱신 동의 슬롯이 덮이면 앞 요청이 영원히 기다리는 결함을 잡았는데, **도달 경로가
 * 여기였다.** 전역 단축키 핸들러는 `<svelte:window onkeydown>` 에 붙어 있고,
 * `ModalShell` 은 **Escape 만** 전파를 막는다. 나머지 키는 전부 window 까지 올라간다.
 *
 * `+page.svelte` 의 `handleGlobalKey` 는 `inEditing`(INPUT·TEXTAREA·contenteditable)
 * 만 보는데, 모달의 기본 초점은 대개 `<button>` 이라 거기 안 걸린다. 그래서 모달이 떠
 * 있는 동안 `⌘R`(rename) 같은 단축키가 그대로 실행됐다.
 *
 * ⚠️ 파일 머리 주석은 *"모달이 이미 열려 있을 때는 CommandPalette 내부 핸들러가 처리"*
 * 라고 적고 있었다 — **팔레트만** 이야기하고 나머지 모달은 아무도 안 막았다.
 * 🔴 주석이 코드보다 좁게 말하던 자리다.
 *
 * ⚠️ `CommandPalette` 는 `ModalShell` 을 **안 쓴다.** 그래서 여기서 전파를 막아도
 * 팔레트의 타이핑·화살표에는 영향이 없다. 확인하고 적는다.
 */

installAnimateStub();

let target: HTMLElement;
let app: Record<string, unknown> | null = null;
let onClose: ReturnType<typeof vi.fn<() => void>>;
/** ⚠️ `addEventListener` 는 시그니처를 따진다 — 맨 `vi.fn()` 은 타입 검사에서 운다. */
let windowSpy: ReturnType<typeof vi.fn<(e: KeyboardEvent) => void>>;

/** ⚠️ 마운트 뒤 한 틈 준다 — `bind:this` 는 이펙트에서 붙는다.
 *  안 기다리면 `backdropEl` 이 아직 null 이라 배경 클릭·초점 트랩이 **다른 가지**로 샌다. */
const show = async () => {
  app = mount(Host, { target, props: { onClose } }) as Record<string, unknown>;
  await flushFrames(1);
};

/** 실제 키 입력처럼 — 해당 요소에서 시작해 위로 버블링한다. */
function press(el: Element, key: string, init: KeyboardEventInit = {}) {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
}

beforeEach(() => {
  onClose = vi.fn<() => void>();
  windowSpy = vi.fn<(e: KeyboardEvent) => void>();
  window.addEventListener("keydown", windowSpy);
  document.body.replaceChildren();
  target = document.createElement("div");
  document.body.appendChild(target);
});

afterEach(async () => {
  window.removeEventListener("keydown", windowSpy);
  if (app) void unmount(app);
  app = null;
  await flushFrames(1);
});

describe("🔴 떠 있는 동안 바깥으로 키가 새지 않는다", () => {
  /**
   * 전역 단축키가 모달 위에서 실행되면 안 된다. 실제로 이것 때문에 두 번째 rename 이
   * 첫 rename 의 동의 요청을 덮어 **첫 rename 이 영원히 기다렸다.**
   */
  it("모달 안에서 누른 단축키가 window 에 안 닿는다", async () => {
    await show();
    const btn = target.querySelector("#b1")!;
    press(btn, "r", { metaKey: true });
    expect(windowSpy, "단축키가 모달을 뚫고 나갔다").not.toHaveBeenCalled();
  });

  it("입력 칸에서 친 글자도 안 나간다", async () => {
    await show();
    const input = target.querySelector("#i1")!;
    press(input, "e", { metaKey: true });
    expect(windowSpy).not.toHaveBeenCalled();
  });

  /** ⚠️ 평범한 글자도 마찬가지다 — 단축키 표에는 modifier 없는 것도 있다. */
  it("modifier 없는 키도 안 나간다", async () => {
    await show();
    press(target.querySelector("#b1")!, "n");
    expect(windowSpy).not.toHaveBeenCalled();
  });

  /** 🔴 모달이 없으면 당연히 나가야 한다 — 안 그러면 앱 전체가 먹통이 된다. */
  it("모달이 닫히면 다시 나간다", async () => {
    await show();
    if (app) void unmount(app);
    app = null;
    await flushFrames();

    press(document.body, "r", { metaKey: true });
    expect(windowSpy, "닫힌 뒤에도 막고 있다").toHaveBeenCalledTimes(1);
  });
});

describe("닫기", () => {
  it("Escape 면 onClose 를 부르고 기본 동작을 막는다", async () => {
    await show();
    const e = press(target.querySelector("#b1")!, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("배경을 누르면 닫는다", async () => {
    await show();
    const backdrop = target.querySelector(".ms-backdrop") as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /** ⚠️ 카드 안을 누른 것은 닫기가 아니다 — 배경과 카드를 구별해야 한다. */
  it("카드 안을 누르면 안 닫는다", async () => {
    await show();
    target.querySelector("#b1")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("초점 트랩", () => {
  /** Tab 이 카드 밖으로 새면 뒤에 있는 화면이 조작된다. */
  it("마지막에서 Tab 하면 처음으로 돈다", async () => {
    await show();
    const last = target.querySelector<HTMLElement>("#b2")!;
    last.focus();
    const e = press(last, "Tab");
    expect(e.defaultPrevented, "Tab 이 그대로 나갔다").toBe(true);
    expect(document.activeElement?.id).toBe("b1");
  });

  it("처음에서 Shift+Tab 하면 마지막으로 돈다", async () => {
    await show();
    const first = target.querySelector<HTMLElement>("#b1")!;
    first.focus();
    const e = press(first, "Tab", { shiftKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe("b2");
  });
});
