import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  DEFAULT_CONTEXT_WIDTH,
  MIN_CONTEXT_WIDTH,
  MAX_CONTEXT_WIDTH,
  mainPane,
  sidebarCollapsed,
  sidebarWidth,
  contextCollapsed,
  contextWidth,
  toggleSidebar,
  expandSidebar,
  collapseSidebar,
  toggleMainPane,
  setMainPane,
  toggleContext,
  expandContext,
  setSidebarWidth,
  setContextWidth,
  resetLayout,
  restorePaneState,
} from "./layout";

/**
 * 레이아웃 store — **테스트가 0이었다.**
 *
 * 여기서 조용히 틀리면 앱이 **잘못된 화면으로 열린다.** 에러는 없고, 사용자는
 * "설정이 날아갔다"로 읽는다. 특히 위험한 것 둘:
 *
 * 1. **구 스키마 마이그레이션** — `{editor, preview}` 2비트에서 `{pane}` enum 으로 옮겼다.
 *    분기가 셋인데(`editor` · `preview` · 손상) 하나도 테스트가 없었다.
 * 2. **접기 어휘 셋** — `toggle` · `expand` · `collapse` 가 각각 다른 뜻이다.
 *    3.0 에서 레일의 활성 아이콘 재클릭이 `collapse` 를 쓰는데, 이게 `toggle` 이면
 *    접힌 상태에서 아이콘을 눌러도 안 펼쳐진다.
 */

beforeEach(() => {
  localStorage.clear();
  mainPane.set("preview");
  sidebarCollapsed.set(false);
  sidebarWidth.set(DEFAULT_SIDEBAR_WIDTH);
  contextCollapsed.set(false);
  contextWidth.set(DEFAULT_CONTEXT_WIDTH);
});

describe("접기 어휘 셋이 서로 다르다", () => {
  it("toggle 은 뒤집는다", () => {
    toggleSidebar();
    expect(get(sidebarCollapsed)).toBe(true);
    toggleSidebar();
    expect(get(sidebarCollapsed)).toBe(false);
  });

  /** ⚠️ 이미 펼쳐 있으면 아무 일도 없어야 한다 — 토글이면 여기서 접힌다. */
  it("expand 는 펼치기만 한다", () => {
    expandSidebar();
    expect(get(sidebarCollapsed)).toBe(false);
    sidebarCollapsed.set(true);
    expandSidebar();
    expect(get(sidebarCollapsed)).toBe(false);
  });

  /**
   * ⚠️ 3.0 의 레일 재클릭이 이걸 쓴다. 토글이면 **접힌 상태에서 아이콘을 눌러도
   * 안 펼쳐진다** — 화면은 그대로고 왜 안 되는지 알 수가 없다.
   */
  it("collapse 는 접기만 한다", () => {
    collapseSidebar();
    expect(get(sidebarCollapsed)).toBe(true);
    collapseSidebar();
    expect(get(sidebarCollapsed)).toBe(true);
  });

  it("collapse 는 접힘을 저장한다", () => {
    collapseSidebar();
    expect(localStorage.getItem("lapis.sidebar-collapsed")).toBe("true");
  });
});

describe("본문 페인 — 교대", () => {
  it("토글이 둘을 오간다", () => {
    toggleMainPane();
    expect(get(mainPane)).toBe("editor");
    toggleMainPane();
    expect(get(mainPane)).toBe("preview");
  });

  /** ⚠️ 같은 값이면 저장도 안 해야 한다 — 매 렌더마다 쓰면 localStorage 가 시끄럽다. */
  it("같은 값을 주면 아무 일도 없다", () => {
    setMainPane("preview");
    expect(localStorage.getItem("lapis.pane-state")).toBeNull();
    setMainPane("editor");
    expect(get(mainPane)).toBe("editor");
  });

  it("컨텍스트 패널은 본문과 독립이다", () => {
    toggleContext();
    expect(get(contextCollapsed)).toBe(true);
    expect(get(mainPane)).toBe("preview");
    expandContext();
    expect(get(contextCollapsed)).toBe(false);
  });
});

describe("폭 클램프", () => {
  it("하한·상한을 지킨다", () => {
    setSidebarWidth(10);
    expect(get(sidebarWidth)).toBe(MIN_SIDEBAR_WIDTH);
    setSidebarWidth(99999);
    expect(get(sidebarWidth)).toBe(MAX_SIDEBAR_WIDTH);
    setContextWidth(10);
    expect(get(contextWidth)).toBe(MIN_CONTEXT_WIDTH);
    setContextWidth(99999);
    expect(get(contextWidth)).toBe(MAX_CONTEXT_WIDTH);
  });

  /** ⚠️ NaN 이 들어오면 기본값으로 — 안 그러면 `Math.max` 가 NaN 을 그대로 뱉는다. */
  it("NaN 은 기본값", () => {
    setSidebarWidth(Number.NaN);
    expect(get(sidebarWidth)).toBe(DEFAULT_SIDEBAR_WIDTH);
    setContextWidth(Number.POSITIVE_INFINITY);
    expect(get(contextWidth)).toBe(DEFAULT_CONTEXT_WIDTH);
  });

  it("소수는 반올림한다", () => {
    setSidebarWidth(260.6);
    expect(get(sidebarWidth)).toBe(261);
  });

  /**
   * ⚠️ **접힘 스트립(34px)보다 하한이 커야 한다.** 하한이 스트립보다 작으면 펼친 폭이
   * 접힌 폭보다 좁을 수 있고, 그러면 접기/펼치기가 뒤집혀 보인다.
   */
  it("하한이 접힘 스트립보다 넓다", () => {
    expect(MIN_SIDEBAR_WIDTH).toBeGreaterThan(34);
    expect(MIN_CONTEXT_WIDTH).toBeGreaterThan(34);
  });
});

describe("구 스키마 마이그레이션 — 분기 셋", () => {
  /** 프리뷰만 접혀 있었다 = 편집을 보고 있었다. */
  it("옛 `{preview: true}` 는 편집으로", () => {
    localStorage.setItem("lapis.pane-state", JSON.stringify({ preview: true }));
    restorePaneState();
    expect(get(mainPane)).toBe("editor");
  });

  /** 둘 다 접힘은 옛 가드가 막던 **손상 상태** — 조용히 읽기로 떨어뜨린다. */
  it("옛 `{preview: true, editor: true}` 는 읽기로", () => {
    localStorage.setItem("lapis.pane-state", JSON.stringify({ preview: true, editor: true }));
    restorePaneState();
    expect(get(mainPane)).toBe("preview");
  });

  it("옛 split(둘 다 펼침)은 읽기로", () => {
    localStorage.setItem("lapis.pane-state", JSON.stringify({ preview: false, editor: false }));
    restorePaneState();
    expect(get(mainPane)).toBe("preview");
  });

  /**
   * ⚠️ 마이그레이션은 **1회로 끝나야 한다.** 옛 스키마를 읽었으면 즉시 새 모양으로
   * 덮어쓴다 — 안 그러면 매 기동마다 같은 변환이 돌고, 그동안 옛 값이 남아 있다.
   */
  it("옛 스키마를 읽으면 새 모양으로 즉시 덮어쓴다", () => {
    localStorage.setItem("lapis.pane-state", JSON.stringify({ preview: true }));
    restorePaneState();
    const after = JSON.parse(localStorage.getItem("lapis.pane-state")!);
    expect(after.pane).toBe("editor");
  });

  it("새 스키마는 그대로 읽는다", () => {
    localStorage.setItem("lapis.pane-state", JSON.stringify({ pane: "editor", context: true }));
    restorePaneState();
    expect(get(mainPane)).toBe("editor");
    expect(get(contextCollapsed)).toBe(true);
  });

  /** ⚠️ 저장값이 깨졌으면 **지운다** — 남겨 두면 매 기동마다 같은 예외가 난다. */
  it("깨진 JSON 은 지우고 기본값으로", () => {
    localStorage.setItem("lapis.pane-state", "{{{");
    restorePaneState();
    expect(get(mainPane)).toBe("preview");
    expect(localStorage.getItem("lapis.pane-state")).toBeNull();
  });

  it("저장값이 없으면 신규 설치 기본값", () => {
    restorePaneState();
    expect(get(mainPane)).toBe("preview");
    expect(get(contextCollapsed)).toBe(false);
  });

  it("저장된 폭이 범위를 벗어나면 클램프해서 읽는다", () => {
    localStorage.setItem("lapis.sidebar-width", "99999");
    localStorage.setItem("lapis.context-width", "1");
    restorePaneState();
    expect(get(sidebarWidth)).toBe(MAX_SIDEBAR_WIDTH);
    expect(get(contextWidth)).toBe(MIN_CONTEXT_WIDTH);
  });

  it("숫자가 아닌 폭은 지운다", () => {
    localStorage.setItem("lapis.sidebar-width", "넓게");
    restorePaneState();
    expect(get(sidebarWidth)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(localStorage.getItem("lapis.sidebar-width")).toBeNull();
  });
});

describe("resetLayout", () => {
  it("전부 신규 설치 상태로 되돌린다", () => {
    setMainPane("editor");
    collapseSidebar();
    toggleContext();
    setSidebarWidth(500);
    setContextWidth(500);

    resetLayout();

    expect(get(mainPane)).toBe("preview");
    expect(get(sidebarCollapsed)).toBe(false);
    expect(get(contextCollapsed)).toBe(false);
    expect(get(sidebarWidth)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(get(contextWidth)).toBe(DEFAULT_CONTEXT_WIDTH);
  });

  /** ⚠️ 되돌린 뒤 **다시 켜도** 되돌아온 상태여야 한다 — 저장을 안 하면 다음 기동에 부활한다. */
  it("되돌린 상태가 저장된다", () => {
    setMainPane("editor");
    collapseSidebar();
    resetLayout();

    mainPane.set("editor");
    sidebarCollapsed.set(true);
    restorePaneState();

    expect(get(mainPane)).toBe("preview");
    expect(get(sidebarCollapsed)).toBe(false);
  });
});
