import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  linkRewritePreviewRequest,
  requestLinkRewritePreview,
  settleLinkRewritePreview,
} from "./linkRewritePreview";
import type { LinkRewritePreview } from "$lib/linkRewrite";

/**
 * 되돌릴 수 없는 쓰기의 **동의 게이트**.
 *
 * ## 🔴 왜 스토어에 함수를 뒀나
 *
 * 이 슬롯은 `resolve` 콜백을 들고 있다. 그래서 **덮어쓰면 이전 요청이 영원히 안 끝난다** —
 * `rewriteAllLinksWithPreview` 가 `await new Promise` 에서 멈춘 채 남는다. 에러도 없고
 * 타임아웃도 없다. 이름은 바뀌었는데 인용은 안 바뀐 상태로 조용히 끝난다.
 *
 * ⚠️ **이건 오늘 잡은 결함과 같은 모양이다** — `clirender::stage` 가 슬롯을 채우면서
 * 지난 요청의 창 표식을 안 지웠다. 슬롯을 덮을 때 이전 점유자를 치우는 것은 규칙이다.
 *
 * `set`/`resolve` 를 손으로 짝지어 부르게 두면 언젠가 한쪽을 빼먹는다. 그래서 **짝을
 * 스토어 안에 가둔다** — 밖에서는 요청하거나 매듭짓거나 둘 뿐이다.
 */

const PREVIEW = (n: number): LinkRewritePreview => ({
  oldStem: "옛 이름",
  newStem: "새 이름",
  items: Array.from({ length: n }, (_, i) => ({
    path: `/v/note-${i}.md`,
    occurrences: i + 1,
    newContent: `바뀐 본문 ${i}`,
  })),
  totalOccurrences: (n * (n + 1)) / 2,
});

beforeEach(() => {
  // 앞 테스트가 남긴 것이 있으면 매듭짓고 시작한다.
  settleLinkRewritePreview(false);
});

describe("요청", () => {
  it("슬롯에 담긴다", () => {
    const resolve = vi.fn();
    requestLinkRewritePreview(PREVIEW(2), resolve);
    expect(get(linkRewritePreviewRequest)?.preview.items).toHaveLength(2);
    expect(resolve, "담기만 했는데 매듭지어졌다").not.toHaveBeenCalled();
  });

  /**
   * 🔴 **덮으면 이전 것을 취소로 닫는다.** 안 그러면 첫 rename 이 영원히 안 끝난다.
   */
  it("새 요청이 오면 지난 요청은 취소로 닫힌다", () => {
    const first = vi.fn();
    const second = vi.fn();
    requestLinkRewritePreview(PREVIEW(1), first);
    requestLinkRewritePreview(PREVIEW(3), second);

    expect(first, "지난 요청이 안 닫혔다 — 그쪽은 영원히 기다린다").toHaveBeenCalledWith(false);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(get(linkRewritePreviewRequest)?.preview.items).toHaveLength(3);
  });
});

describe("매듭짓기", () => {
  it("적용이면 true 로 닫고 슬롯을 비운다", () => {
    const resolve = vi.fn();
    requestLinkRewritePreview(PREVIEW(1), resolve);
    settleLinkRewritePreview(true);
    expect(resolve).toHaveBeenCalledWith(true);
    expect(get(linkRewritePreviewRequest)).toBeNull();
  });

  it("취소면 false 로 닫는다", () => {
    const resolve = vi.fn();
    requestLinkRewritePreview(PREVIEW(1), resolve);
    settleLinkRewritePreview(false);
    expect(resolve).toHaveBeenCalledWith(false);
  });

  /**
   * ⚠️ 두 번 눌려도 한 번만. 모달이 닫히는 경로가 넷이라(적용 · 취소 · ✕ · 배경/ESC)
   * 겹쳐 들어올 수 있다. `resolve` 가 두 번 불리면 두 번째는 조용히 무시되지만,
   * **그 사이에 새 요청이 들어와 있으면 남의 요청을 닫는다.**
   */
  it("두 번 매듭지어도 한 번만 닫힌다", () => {
    const resolve = vi.fn();
    requestLinkRewritePreview(PREVIEW(1), resolve);
    settleLinkRewritePreview(true);
    settleLinkRewritePreview(false);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(true);
  });

  it("빈 슬롯을 매듭지어도 터지지 않는다", () => {
    expect(() => settleLinkRewritePreview(true)).not.toThrow();
    expect(get(linkRewritePreviewRequest)).toBeNull();
  });

  /** 매듭지은 뒤에 온 요청은 온전히 새것이다. */
  it("닫은 뒤 새로 요청할 수 있다", () => {
    const a = vi.fn();
    const b = vi.fn();
    requestLinkRewritePreview(PREVIEW(1), a);
    settleLinkRewritePreview(true);
    requestLinkRewritePreview(PREVIEW(2), b);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(get(linkRewritePreviewRequest)?.preview.items).toHaveLength(2);
  });
});
