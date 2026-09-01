import { describe, it, expect, beforeEach } from "vitest";
import { renderQueriesIn, type QueryContext } from "./queryRuntime";
import type { LinkInfo } from "./tauri/notes";

/**
 * 저장된 질의를 **그리는 쪽**.
 *
 * 고르는 일은 `tableView.ts` 의 `filterRows` 가 하고 그건 이미 덮여 있다. 여기서 잴 것은
 * 그 결과가 **화면에 정직하게** 나오나다:
 *
 * - 몇 건인지 먼저 말하나 (잘린 목록만 보여주면 그게 전부인 줄 안다)
 * - 자른 것을 말하나
 * - 틀린 질의를 **빈 칸으로 두지 않나** — 빈 칸은 "결과 없음"과 구별이 안 된다
 * - 🔴 결과 줄이 **위키링크 계약**을 지키나 (`span.wikilink[data-target]`)
 */

const T = {
  badQuery: "못 읽었다",
  noIndex: "인덱스 없다",
  empty: "없다",
  count: (n: number) => `${n}건`,
};

function note(p: Partial<LinkInfo> & { source_path: string }): LinkInfo {
  return {
    source_name: p.source_path.split("/").pop() ?? "",
    title: null,
    aliases: [],
    targets: [],
    tags: [],
    doc_kind: null,
    topic: null,
    related: [],
    props: {},
    ...p,
  };
}

const CTX: QueryContext = {
  vaultRoot: "/v",
  infos: [
    note({ source_path: "/v/a.md", doc_kind: "plan", topic: "overview", tags: ["subject/UI"] }),
    note({ source_path: "/v/sub/b.md", doc_kind: "plan", topic: "search", tags: ["tech/rust"] }),
    note({ source_path: "/v/c.md", doc_kind: "adr", topic: "overview", tags: ["subject/cli"] }),
  ],
};

let root: HTMLElement;

/** 플러그인이 내는 것과 같은 자리를 만든다. */
function host(source: string): HTMLElement {
  const d = document.createElement("div");
  d.className = "lapis-query-host";
  d.setAttribute("data-source", source);
  root.appendChild(d);
  return d;
}

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement("div");
  document.body.appendChild(root);
});

describe("결과를 그린다", () => {
  it("맞는 노트를 줄로 낸다", () => {
    host("doc_kind: plan");
    renderQueriesIn(root, CTX, T);
    const names = [...root.querySelectorAll(".lapis-query-list .wikilink")].map(
      (e) => e.textContent,
    );
    expect(names).toEqual(["a", "b"]);
  });

  /** 🔴 몇 건인지 **먼저** 말한다. */
  it("건수를 말한다", () => {
    host("topic: overview");
    renderQueriesIn(root, CTX, T);
    expect(root.querySelector(".lapis-query-title")?.textContent).toBe("2건");
  });

  it("축 여럿이면 둘 다 만족해야 한다", () => {
    host("doc_kind: plan\ntopic: overview");
    renderQueriesIn(root, CTX, T);
    const names = [...root.querySelectorAll(".wikilink")].map((e) => e.textContent);
    expect(names).toEqual(["a"]);
  });

  it("맞는 게 없으면 없다고 말한다", () => {
    host("doc_kind: 없는종류");
    renderQueriesIn(root, CTX, T);
    expect(root.querySelector(".lapis-query-empty")?.textContent).toBe("없다");
    expect(root.querySelector(".lapis-query-title")?.textContent).toBe("0건");
  });

  /** ⚠️ 조용히 자르면 결과 수와 줄 수가 어긋난 채로 읽힌다. */
  it("자른 것을 말한다", () => {
    host("doc_kind: plan\nlimit: 1");
    renderQueriesIn(root, CTX, T);
    expect(root.querySelectorAll(".lapis-query-list li")).toHaveLength(1);
    expect(root.querySelector(".lapis-query-title")?.textContent, "건수는 전체여야 한다").toBe(
      "2건",
    );
    expect(root.querySelector(".lapis-query-more")?.textContent).toContain("1");
  });
});

/**
 * 🔴 **결과 줄은 위키링크다.** 새 클릭 규칙을 만들지 않고 `previewClick.ts` 의 같은
 * 규칙에 태운다 — 본문 칸이든 옆칸이든 동작이 같아진다.
 *
 * ⚠️ 그래서 `data-target` 은 **경로가 아니라 이름**이어야 한다. 경로를 넣으면
 * `jumpToWikilink` 가 못 푼다.
 */
describe("클릭 계약", () => {
  it("span.wikilink 이고 data-target 은 이름이다", () => {
    host("doc_kind: plan\nlimit: 1");
    renderQueriesIn(root, CTX, T);
    const link = root.querySelector(".wikilink")!;
    expect(link.tagName, "앵커로 내면 웹뷰가 떠난다").toBe("SPAN");
    expect(link.getAttribute("data-target"), "경로가 아니라 이름").toBe("a");
    expect(link.getAttribute("role")).toBe("link");
    expect(link.getAttribute("tabindex")).toBe("0");
  });

  it("같은 이름이 있을 때를 위해 경로도 같이 보여준다", () => {
    host("doc_kind: plan");
    renderQueriesIn(root, CTX, T);
    const subs = [...root.querySelectorAll(".lapis-query-sub")].map((e) => e.textContent);
    expect(subs.some((s) => s?.includes("b"))).toBe(true);
  });
});

describe("🔴 틀린 것을 빈 칸으로 두지 않는다", () => {
  it("모르는 키면 이유를 보여준다", () => {
    host("tags: lapis");
    renderQueriesIn(root, CTX, T);
    const box = root.querySelector(".lapis-query--error");
    expect(box, "오류인데 아무것도 안 그렸다").not.toBeNull();
    expect(box?.textContent).toContain("못 읽었다");
    expect(box?.textContent, "무엇이 틀렸는지 말해야 고친다").toContain("모르는 키");
  });

  it("빈 질의는 전량이 아니라 오류다", () => {
    host("");
    renderQueriesIn(root, CTX, T);
    expect(root.querySelector(".lapis-query--error")).not.toBeNull();
    expect(root.querySelectorAll(".lapis-query-list li")).toHaveLength(0);
  });

  it("인덱스가 아직 없으면 그렇다고 말한다", () => {
    host("doc_kind: plan");
    renderQueriesIn(root, null, T);
    expect(root.querySelector(".lapis-query--error")?.textContent).toContain("인덱스 없다");
  });
});

describe("두 번 돌아도 안전하다", () => {
  /** ⚠️ 후처리는 본문이 다시 그려질 때마다 돈다. 이미 채운 자리를 또 채우면 겹친다. */
  it("이미 채운 자리는 건너뛴다", () => {
    host("doc_kind: plan");
    renderQueriesIn(root, CTX, T);
    renderQueriesIn(root, CTX, T);
    expect(root.querySelectorAll(".lapis-query")).toHaveLength(1);
    expect(root.querySelectorAll(".lapis-query-list li")).toHaveLength(2);
  });
});

/**
 * 🔴 **태그는 `filterRows` 가 아니라 `$lib/tagMatch` 가 판정한다.** 표 화면에 태그
 * 칩이 없어서 그쪽 매처에는 안 넣었다 — 넣고 화면을 안 고치면 **쓸 수 없는 능력**이 된다.
 *
 * 그래도 규칙은 하나다. `tagMatch` 는 앱 필터도 `core/query.ts` 의 `tag` 축도 쓴다.
 */
describe("태그 축", () => {
  it("정확한 태그로 고른다", () => {
    host("tag: tech/rust");
    renderQueriesIn(root, CTX, T);
    expect([...root.querySelectorAll(".wikilink")].map((e) => e.textContent)).toEqual(["b"]);
  });

  /** nested — `subject` 로 물으면 `subject/*` 가 다 걸린다. */
  it("상위 태그로 물으면 하위가 걸린다", () => {
    host("tag: subject");
    renderQueriesIn(root, CTX, T);
    expect([...root.querySelectorAll(".wikilink")].map((e) => e.textContent)).toEqual(["a", "c"]);
  });

  /** ⚠️ 대소문자를 가리지 않는다 — 픽스처의 `a` 는 `subject/UI` 로 적혀 있다. */
  it("대소문자를 안 가린다", () => {
    host("tag: subject/ui");
    renderQueriesIn(root, CTX, T);
    expect([...root.querySelectorAll(".wikilink")].map((e) => e.textContent)).toEqual(["a"]);
  });

  /** 축 사이는 AND — 태그와 doc_kind 를 같이 주면 둘 다 만족해야 한다. */
  it("다른 축과 AND 로 걸린다", () => {
    host("doc_kind: plan\ntag: subject");
    renderQueriesIn(root, CTX, T);
    expect([...root.querySelectorAll(".wikilink")].map((e) => e.textContent)).toEqual(["a"]);
  });

  it("없는 태그면 0건", () => {
    host("tag: 없는태그");
    renderQueriesIn(root, CTX, T);
    expect(root.querySelector(".lapis-query-title")?.textContent).toBe("0건");
  });
});
