import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  inDocSearch,
  applySearch,
  resetSearch,
  setMatchInfo,
  setQuery,
  closeSearch,
} from "./stores/inDocSearch";

/**
 * 검색 **인계** — 다른 화면에서 넘어올 때.
 *
 * ## 🔴 본문이 먼저 오고 질의가 나중에 온다
 *
 * `grep` 결과나 미완 작업에서 노트로 넘어가면 순서가 이렇다:
 *
 * 1. `selectNote` → 프리뷰 HTML 이 새 본문으로 바뀐다
 * 2. `applySearch` → 질의가 스토어에 들어온다
 *
 * 프리뷰 하이라이트는 **HTML 이 바뀔 때만** 다시 걸리고 질의는 비반응으로 읽는다
 * (`setMatchInfo` 가 스토어를 갱신하므로 질의를 의존성으로 만들면 다음 일치로 넘어갈
 * 때마다 위치가 0 으로 되돌아간다). 그래서 위 순서에서는 **하이라이트가 영영 안 걸렸다.**
 *
 * 실측으로 걸렸다 — 작업 항목을 눌러 노트로 갔는데 검색바에 글자는 있고 표시가 0개였다.
 */

beforeEach(() => {
  closeSearch();
  resetSearch();
});

describe("인계 번호", () => {
  it("applySearch 가 부를 때만 는다", () => {
    const before = get(inDocSearch).handoff;
    applySearch("가", { regex: false, caseSensitive: false, wholeWord: false }, "preview");
    expect(get(inDocSearch).handoff).toBe(before + 1);
  });

  /**
   * 🔴 **`setMatchInfo` 로는 안 는다.** 늘면 다음 일치로 넘어갈 때마다 화면이 인계로
   * 오인하고 현재 위치를 0 으로 되돌린다 — 다음 일치 버튼이 제자리를 맴돈다.
   */
  it("setMatchInfo 로는 안 는다", () => {
    applySearch("가", { regex: false, caseSensitive: false, wholeWord: false }, "preview");
    const n = get(inDocSearch).handoff;
    setMatchInfo(5, 2);
    setMatchInfo(5, 3);
    expect(get(inDocSearch).handoff).toBe(n);
  });

  it("setQuery 로도 안 는다 — 타이핑은 인계가 아니다", () => {
    const n = get(inDocSearch).handoff;
    setQuery("타이핑");
    expect(get(inDocSearch).handoff).toBe(n);
  });

  /**
   * 🔴 **되돌리면 안 된다.** 0 으로 돌아가면 다음 인계가 "이미 본 번호"가 돼서 조용히
   * 무시된다 — 노트를 바꿀 때마다 `resetSearch` 가 도므로 실제로 자주 일어난다.
   */
  it("resetSearch 가 번호를 안 되돌린다", () => {
    applySearch("가", { regex: false, caseSensitive: false, wholeWord: false }, "preview");
    applySearch("나", { regex: false, caseSensitive: false, wholeWord: false }, "preview");
    const n = get(inDocSearch).handoff;
    expect(n).toBeGreaterThan(0);
    resetSearch();
    expect(get(inDocSearch).handoff).toBe(n);
  });

  it("연달아 인계하면 계속 는다", () => {
    const a = get(inDocSearch).handoff;
    applySearch("가", { regex: false, caseSensitive: false, wholeWord: false }, "preview");
    resetSearch();
    applySearch("나", { regex: false, caseSensitive: false, wholeWord: false }, "preview");
    expect(get(inDocSearch).handoff).toBe(a + 2);
  });
});

describe("인계가 담는 것", () => {
  it("질의·옵션·대상을 한 번에", () => {
    applySearch("찾을 것", { regex: true, caseSensitive: true, wholeWord: false }, "preview");
    const s = get(inDocSearch);
    expect(s.query).toBe("찾을 것");
    expect(s.target).toBe("preview");
    expect(s.open).toBe(true);
    expect(s.options).toEqual({ regex: true, caseSensitive: true, wholeWord: false });
  });
});

/**
 * ⚠️ **화면이 그 번호를 실제로 보는가.** 스토어가 초록이어도 아무도 안 보면 하이라이트는
 * 여전히 안 걸린다 — 그게 원래 증상이었다.
 */
describe("배선", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../routes/+page.svelte", import.meta.url)),
    "utf-8",
  );

  it("인계 번호를 보는 effect 가 있다", () => {
    expect(src).toMatch(/s\.handoff === lastHandoff/);
    expect(src).toMatch(/lastHandoff = s\.handoff/);
  });

  /** ⚠️ 본문이 그려진 뒤에 걸어야 한다 — 아직 옛 본문이면 안 맞거나 엉뚱한 데를 잡는다. */
  it("본문이 그려진 뒤에 건다", () => {
    const at = src.indexOf("lastHandoff = s.handoff");
    const after = src.indexOf("afterPreviewRender", at);
    expect(after).toBeGreaterThan(at);
  });
});

/** 미완 작업에서 넘어가는 자리 — 정규식이 아니라 리터럴이어야 한다. */
describe("미완 작업에서 넘어갈 때", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./VaultHygieneModal.svelte", import.meta.url)),
    "utf-8",
  );

  it("작업 글자로 인계한다", () => {
    expect(src).toMatch(/applySearch\(\s*text,/);
  });

  /**
   * ⚠️ **리터럴로 넘긴다.** 작업 문장에 `(`·`*` 가 들어 있으면 정규식으로는 안 맞거나
   * 죽는다 — 할 일 목록에 괄호는 흔하다.
   */
  it("정규식이 아니라 리터럴로", () => {
    expect(src).toMatch(/\{ regex: false, caseSensitive: false, wholeWord: false \}/);
  });
});
