import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, unmount } from "svelte";
import { get } from "svelte/store";
import Modal from "./LinkRewritePreviewModal.svelte";
import {
  linkRewritePreviewRequest,
  requestLinkRewritePreview,
  settleLinkRewritePreview,
} from "./stores/linkRewritePreview";
import type { LinkRewritePreview } from "./linkRewrite";
import { installAnimateStub, flushFrames } from "./testHarness/animateStub";

/**
 * 링크 갱신 미리보기 모달 — **되돌릴 수 없는 쓰기의 동의 게이트.**
 *
 * ## 🔴 왜 이 파일이 필요했나
 *
 * 커버리지 지도에서 이 컴포넌트는 "안 닿음" 칸에 있었다. 아무 테스트도 이름조차 몰랐다.
 * 그런데 여기서 누르는 버튼 하나가 vault 의 여러 노트를 **한꺼번에 고친다.**
 *
 * ⚠️ 저장소 불변식이 이미 이렇게 적혀 있다 — *"되돌릴 수 없는 쓰기는 보여주고 멈춘다."*
 * 멈추는 자리가 바로 여기인데, 그 자리를 아무도 안 재고 있었다.
 *
 * ⚠️ 라벨 문자열로 찾지 않는다. paraglide 의 `baseLocale` 이 영어라 하네스에서는 영어가
 * 나오고, 번역을 고치면 테스트가 깨진다. **구조로 찾는다.**
 */

installAnimateStub();
const flush = flushFrames;

const PREVIEW: LinkRewritePreview = {
  oldStem: "옛 이름",
  newStem: "새 이름",
  items: [
    { path: "/v/a.md", occurrences: 2, newContent: "가" },
    { path: "/v/sub/b.md", occurrences: 5, newContent: "나" },
  ],
  totalOccurrences: 7,
};

let target: HTMLElement;
let app: Record<string, unknown> | null = null;

const show = () => {
  app = mount(Modal, { target }) as Record<string, unknown>;
};

/** 이 모달의 버튼들 — 구조로 집는다. */
const apply = () => target.querySelector<HTMLButtonElement>(".btn--primary");
const cancel = () => target.querySelector<HTMLButtonElement>(".btn--ghost");
const dismiss = () => target.querySelector<HTMLButtonElement>("button.x");

beforeEach(() => {
  settleLinkRewritePreview(false);
  document.body.replaceChildren();
  target = document.createElement("div");
  document.body.appendChild(target);
});

afterEach(() => {
  if (app) void unmount(app);
  app = null;
  settleLinkRewritePreview(false);
});

describe("안 떠 있을 때", () => {
  it("요청이 없으면 아무것도 안 그린다", () => {
    show();
    expect(target.querySelector(".modal")).toBeNull();
  });
});

describe("떠 있을 때", () => {
  it("바뀌는 노트와 건수를 그대로 보여준다", async () => {
    show();
    requestLinkRewritePreview(PREVIEW, vi.fn());
    await flush();

    const paths = [...target.querySelectorAll(".affected .path")].map((e) => e.textContent);
    const counts = [...target.querySelectorAll(".affected .count")].map((e) => e.textContent);
    expect(paths).toEqual(["/v/a.md", "/v/sub/b.md"]);
    expect(counts).toEqual(["2", "5"]);
  });

  it("옛 이름과 새 이름을 같이 보여준다", async () => {
    show();
    requestLinkRewritePreview(PREVIEW, vi.fn());
    await flush();
    const summary = target.querySelector(".summary")?.textContent ?? "";
    expect(summary).toContain("옛 이름");
    expect(summary).toContain("새 이름");
  });

  /**
   * 🔴 **기본 초점은 "안 함" 쪽이다.** 되돌릴 수 없는 쓰기에서 Enter 한 번이 적용으로
   * 가면 안 된다. 사용자가 모달을 못 읽고 Enter 를 쳤을 때 최악이 "아무 일도 안 남"이어야
   * 한다.
   */
  it("기본 초점이 취소다", async () => {
    show();
    requestLinkRewritePreview(PREVIEW, vi.fn());
    await flush();
    expect(cancel()?.hasAttribute("data-autofocus"), "취소가 기본이 아니다").toBe(true);
    expect(apply()?.hasAttribute("data-autofocus"), "적용이 기본 초점을 가져갔다").toBe(false);
  });
});

describe("닫는 길 — 적용만 true 다", () => {
  const cases: { name: string; hit: () => HTMLButtonElement | null; want: boolean }[] = [
    { name: "적용", hit: apply, want: true },
    { name: "취소", hit: cancel, want: false },
    { name: "✕", hit: dismiss, want: false },
  ];

  for (const c of cases) {
    it(`${c.name} → ${c.want}`, async () => {
      const resolve = vi.fn();
      show();
      requestLinkRewritePreview(PREVIEW, resolve);
      await flush();

      const btn = c.hit();
      expect(btn, `${c.name} 버튼이 없다`).toBeTruthy();
      btn!.click();
      await flush();

      expect(resolve).toHaveBeenCalledWith(c.want);
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(get(linkRewritePreviewRequest), "슬롯이 안 비었다").toBeNull();
    });
  }

  /** ⚠️ 닫힌 뒤에는 사라진다 — 남아 있으면 다음 rename 의 미리보기와 겹쳐 보인다. */
  it("닫으면 화면에서 사라진다", async () => {
    show();
    requestLinkRewritePreview(PREVIEW, vi.fn());
    await flush();
    expect(target.querySelector(".modal")).not.toBeNull();

    cancel()!.click();
    await flush();
    expect(target.querySelector(".modal")).toBeNull();
  });
});
