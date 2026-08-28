import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import VaultHygieneModal from "./VaultHygieneModal.svelte";
import { buildIndex } from "./linkIndex";
import { linkIndex } from "$lib/stores/vault";
import { brokenLinksOpen } from "$lib/stores/brokenLinks";
import { vaultPath } from "$lib/stores/vault";
import type { LinkInfo } from "$lib/tauri/notes";

/**
 * ⚠️ 넷째 탭만 **본문**을 읽는다(`read_vault_bundle`). 나머지 셋은 인덱스만 본다.
 * 여기서 목을 두는 이유는 그 비대칭 자체가 이 탭의 설계라서다 — 목이 없으면 탭이
 * 조용히 "실패" 상태로 떨어지고, 그건 빈 화면과 구별이 안 된다.
 */
const bundleBodies = vi.fn<() => Record<string, string>>(() => ({}));
let bundleFails = false;
vi.mock("$lib/tauri/notes", () => ({
  readVaultBundle: async () => {
    if (bundleFails) throw new Error("read failed");
    return {
      links: [],
      contents: Object.entries(bundleBodies()).map(([path, body]) => ({
        path,
        name: path,
        body,
      })),
      stats: { walk_ms: 0, read_ms: 0, file_count: 0 },
    };
  },
}));

/**
 * vault 위생 모달이 **실제로 그리는 것**을 본다.
 *
 * ## 왜 이 테스트가 있나
 *
 * 감사 로직(`$lib/vaultAudit`)은 순수 함수라 `vaultAudit.test.ts`가 이미 고정하고 있고,
 * 같은 함수를 CLI(`lapis links --orphans` · `lapis tag audit`)도 쓴다. **데이터는 검증돼
 * 있었다.** 검증이 안 닿은 곳은 정확히 하나 — 그 데이터를 **Svelte 마크업이 어떻게
 * 그리는가**였다.
 *
 * 그 틈이 위험한 이유: 순수 함수가 맞는 답을 내도 마크업이 엉뚱한 필드를 그리거나
 * 탭 하나가 통째로 비면 **아무 에러도 안 난다.** 앱은 멀쩡히 뜨고 화면만 비어 있다.
 *
 * ⚠️ 여기서 고정하는 것은 **구조와 숫자**지 문구가 아니다. 라벨 문자열을 박으면 i18n
 * 메시지를 고칠 때마다 테스트가 깨져서, 결국 아무도 안 읽고 지워 버린다.
 */

const mkInfo = (path: string, extra: Partial<LinkInfo> = {}): LinkInfo => {
  const segs = path.split("/").filter(Boolean);
  return {
    source_path: path,
    source_name: (segs[segs.length - 1] ?? path).replace(/\.md$/i, ""),
    title: null,
    aliases: [],
    tags: [],
    doc_kind: null,
    topic: null,
    related: [],
    targets: [],
    props: {},
    ...extra,
  };
};

/**
 * 세 탭이 **동시에** 뭔가를 갖도록 만든 vault.
 *
 * - 끊긴 링크: `hub` → `[[없는문서]]`
 * - 고아: `lonely`(들어오는 링크 0) — `hub`도 고아지만 나가는 링크가 2다
 * - 태그: `Tech`/`tech`(대소문자만 다름), `a/note`·`b/note`(같은 잎)
 * - 모호한 이름: `x/dup` · `y/dup`
 */
function fixture() {
  return buildIndex([
    mkInfo("/v/hub.md", { targets: ["없는문서", "seen"], tags: ["Tech", "a/note"] }),
    mkInfo("/v/seen.md", { tags: ["tech", "b/note"] }),
    mkInfo("/v/lonely.md"),
    mkInfo("/v/x/dup.md"),
    mkInfo("/v/y/dup.md"),
  ]);
}

let host: HTMLDivElement;
let comp: Record<string, unknown> | null = null;

function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  comp = mount(VaultHygieneModal, { target: host });
  flushSync();
}

/** 탭 버튼을 라벨이 아니라 **위치**로 고른다 — 문구에 묶이지 않기 위해서다. */
function tabs(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
}

function clickTab(i: number) {
  tabs()[i].click();
  flushSync();
}

const textOf = (sel: string) =>
  [...document.querySelectorAll(sel)].map((e) => e.textContent?.trim() ?? "");

beforeEach(() => {
  bundleBodies.mockReturnValue({});
  bundleFails = false;
  vaultPath.set("/v");
  linkIndex.set(fixture());
  brokenLinksOpen.set(true);
  render();
});

afterEach(() => {
  if (comp) unmount(comp);
  comp = null;
  host?.remove();
  brokenLinksOpen.set(false);
  linkIndex.set(null);
  vaultPath.set(null);
});

describe("탭 바", () => {
  it("탭이 다섯이고 각각 숫자를 단다", () => {
    const badges = textOf(".tab .badge");
    expect(badges).toHaveLength(5);
    // 끊긴 링크 1(없는문서) · 고아 4(hub·lonely·dup 둘) · 태그 2묶음 + 모호한 이름 1 = 3
    // 넷째는 아직 안 셌다 — 본문을 읽어야 알 수 있고, 탭을 열기 전에는 안 읽는다.
    // 다섯째(속성)는 픽스처에 frontmatter 값이 없어 0이다.
    expect(badges).toEqual(["1", "4", "3", "–", "0"]);
  });

  /**
   * ⚠️ **0이 아니라 – 여야 한다.** 0은 "봤는데 없다"는 뜻이라, 아무것도 안 읽고 0을
   * 띄우면 깨끗하지 않은 vault를 깨끗하다고 말하게 된다. 조용히 틀리는 종류다.
   */
  it("안 센 탭의 배지는 0이 아니다", () => {
    expect(textOf(".tab .badge")[3]).not.toBe("0");
  });

  /**
   * ⚠️ **카나리아.** 숫자가 전부 0이면 위 단언은 통과할 수 있어도 화면은 빈 것이다.
   * 픽스처가 실제로 셋 다 채웠는지 따로 못 박는다 — 그래야 아래 탭 테스트가
   * "빈 목록을 확인하며 통과"하지 않는다.
   */
  it("픽스처가 인덱스만으로 되는 세 탭을 전부 채웠다", () => {
    expect(textOf(".tab .badge").slice(0, 3).every((n) => Number(n) > 0)).toBe(true);
  });

  it("첫 탭이 선택된 채로 열린다", () => {
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs().filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  it("탭을 누르면 선택이 옮겨간다", () => {
    clickTab(1);
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs()[0].getAttribute("aria-selected")).toBe("false");
  });
});

describe("고아 탭", () => {
  beforeEach(() => clickTab(1));

  /**
   * **나가는 링크가 적은 것부터**, 같으면 경로순.
   *
   * ⚠️ 예전엔 경로순만이었다. 그러면 진입점이 맨 위에 온다 — 실제 vault 의 `HOME.md` 는
   * 나가는 링크가 19개인데 아무도 안 가리킨다(당연하다). 첫 줄이 매번 "고칠 것 아님"이면
   * 목록 전체를 덜 보게 된다.
   *
   * 동명이인(`dup` 둘)이 있어도 순서가 흔들리지 않아야 한다.
   */
  it("떨어진 섬이 먼저, 진입점이 뒤", () => {
    expect(textOf(".rows .src")).toEqual(["lonely", "dup", "dup", "hub"]);
  });

  /**
   * **나가는 링크 수가 같이 보여야 한다.** 이게 허브(진입점)와 떨어진 섬을 가르는
   * 유일한 단서다 — HOME처럼 들어오는 링크가 없어도 정상인 문서가 있기 때문이다.
   * 이름만 그리면 목록이 판단을 못 돕는다.
   */
  it("행마다 나가는 링크 수가 함께 나온다", () => {
    const counts = textOf(".rows .count");
    expect(counts).toHaveLength(4);
    // 문구(로케일)에 묶이지 않도록 숫자만 본다. 정렬이 오름차순이라 `hub`(1)가 뒤다.
    expect(counts.map((c) => c.match(/\d+/)?.[0])).toEqual(["0", "0", "0", "1"]);
  });

  /**
   * ⚠️ **끊긴 링크는 나가는 링크로 세지 않는다.** `hub`의 `targets`는 둘인데
   * (`없는문서` · `seen`) 화면에는 **1**이 뜬다 — 해소되지 않는 링크는 밖으로 나가는
   * 길이 아니고, 그건 끊긴 링크 탭의 몫이기 때문이다.
   *
   * 이걸 못 박아 두는 이유: 화면만 보면 "링크를 두 개 썼는데 왜 1이지"로 읽혀서,
   * 나중에 누군가 `targets.length`로 "고치기" 쉽다. 그러면 끊긴 링크만 잔뜩 단 노트가
   * 허브로 보인다.
   */
  it("끊긴 링크는 나가는 링크 수에 안 들어간다", () => {
    const hubTargets = 2; // 없는문서 · seen
    // ⚠️ 자리로 찾지 않는다 — 정렬이 바뀌면 엉뚱한 행을 보고도 통과한다.
    const rows = [...document.querySelectorAll(".rows > li")];
    const hubRow = rows.find((r) => r.querySelector(".src")?.textContent?.trim() === "hub");
    expect(hubRow, "hub 행을 못 찾았다").toBeTruthy();
    expect(hubRow!.querySelector(".count")?.textContent?.match(/\d+/)?.[0]).toBe("1");
    expect(hubTargets).toBeGreaterThan(1);
  });

  it("경로는 title 속성으로 남는다 — 목록에는 이름만 그린다", () => {
    const first = document.querySelector<HTMLButtonElement>(".rows .src");
    expect(first?.textContent?.trim()).toBe("lonely");
    expect(first?.getAttribute("title")).toBe("/v/lonely.md");
  });
});

describe("태그 탭", () => {
  beforeEach(() => clickTab(2));

  it("종류별 묶음마다 라벨과 칩이 있다", () => {
    const groups = [...document.querySelectorAll(".group")];
    // 태그 문제 2묶음 + 모호한 이름 1묶음
    expect(groups).toHaveLength(3);
    for (const g of groups) {
      expect(g.querySelector(".group-label")?.textContent?.trim()).toBeTruthy();
    }
  });

  it("칩이 태그 이름과 건수를 같이 낸다", () => {
    const chips = textOf(".chips .chip");
    expect(chips.length).toBeGreaterThan(0);
    // `Tech`와 `tech`가 둘 다 칩으로 나온다 — 대소문자만 다른 쌍이 핵심이다.
    expect(chips.some((c) => c.startsWith("Tech"))).toBe(true);
    expect(chips.some((c) => c.startsWith("tech"))).toBe(true);
  });

  it("모호한 이름은 후보 경로를 전부 편다", () => {
    const names = textOf(".group .target code");
    expect(names).toContain("dup");
    const paths = [...document.querySelectorAll<HTMLButtonElement>(".group .sources .src")].map(
      (b) => b.getAttribute("title"),
    );
    expect(paths).toEqual(["/v/x/dup.md", "/v/y/dup.md"]);
  });
});

describe("끊긴 링크 탭", () => {
  it("끊긴 대상과 그것을 가리키는 노트를 낸다", () => {
    expect(textOf(".targets .target code")).toEqual(["[[없는문서]]"]);
    expect(textOf(".targets .sources .src")).toEqual(["hub"]);
  });
});

describe("빈 상태", () => {
  /**
   * 깨끗한 vault에서 **탭이 사라지지 않는지** 본다. 숫자 0을 보여주는 것이
   * 이 화면의 값이다 — 목록이 비면 탭까지 없애는 구현이면 "왜 안 보이지"가 된다.
   */
  it("문제가 없어도 탭 다섯과 0이 남는다", () => {
    // 서로 가리키는 두 노트 — 어느 쪽도 고아가 아니고 끊긴 링크도 없다.
    linkIndex.set(
      buildIndex([mkInfo("/v/a.md", { targets: ["b"] }), mkInfo("/v/b.md", { targets: ["a"] })]),
    );
    flushSync();
    expect(textOf(".tab .badge")).toEqual(["0", "0", "0", "–", "0"]);
    expect(document.querySelector(".empty")).not.toBeNull();
  });
});

describe("vault가 없을 때", () => {
  it("탭 대신 안내만 낸다", () => {
    linkIndex.set(null);
    flushSync();
    expect(tabs()).toHaveLength(0);
    expect(document.querySelector(".empty")).not.toBeNull();
  });
});

describe("안 걸린 언급 탭", () => {
  /** ⚠️ 다른 셋과 달리 탭을 **열 때** 본문을 읽는다. 앱은 본문을 들고 있지 않다. */
  const settle = async () => {
    await vi.waitFor(() => {
      flushSync();
      // ⚠️ 문구가 아니라 **표식**으로 기다린다. 문구로 기다리면 i18n을 고칠 때
      //    조용히 "읽는 중" 화면을 검사하게 된다 — 실제로 한 번 그랬다.
      expect(document.querySelector(".empty.loading")).toBeNull();
    });
  };

  it("탭을 열면 그때 읽어서 목록을 낸다", async () => {
    bundleBodies.mockReturnValue({
      "/v/hub.md": "여기서도 seen 을 말한다",
      "/v/seen.md": "본문",
      "/v/lonely.md": "여기서 seen 을 말한다",
      "/v/x/dup.md": "본문",
      "/v/y/dup.md": "본문",
    });
    clickTab(3);
    await settle();
    // hub 는 이미 `seen` 으로 링크가 있다 — 같은 말을 해도 간선은 이미 있다.
    expect(textOf(".targets .target .src")).toEqual(["seen"]);
    expect(textOf(".targets .sources .src")).toEqual(["lonely:1"]);
    expect(textOf(".preview")).toEqual(["여기서 seen 을 말한다"]);
  });

  it("배지가 – 에서 실제 숫자로 바뀐다", async () => {
    bundleBodies.mockReturnValue({ "/v/lonely.md": "여기서 seen 을 말한다" });
    expect(textOf(".tab .badge")[3]).toBe("–");
    clickTab(3);
    await settle();
    expect(textOf(".tab .badge")[3]).toBe("1");
  });

  /**
   * ⚠️ 읽기 실패를 빈 목록으로 삼키면 **"깨끗하다"로 보인다.** 이 감사에서 가장
   * 조용한 고장이라 따로 못 박는다.
   */
  it("본문을 못 읽으면 비었다고 하지 않는다", async () => {
    bundleFails = true;
    clickTab(3);
    await settle();
    expect(textOf(".empty")).toEqual([expect.not.stringMatching(/^$/)]);
    expect(textOf(".tab .badge")[3]).toBe("–");
  });
});

describe("속성 탭", () => {
  /**
   * ⚠️ 이 탭은 **인덱스만으로** 된다 — 넷째와 달리 본문을 안 읽는다. 배지가 처음부터
   * 숫자인 것이 그 차이를 드러낸다.
   */
  it("갈린 값을 필드별로 묶어 낸다", () => {
    linkIndex.set(
      buildIndex([
        mkInfo("/v/a.md", { doc_kind: "todo" }),
        mkInfo("/v/b.md", { doc_kind: "todos" }),
        mkInfo("/v/c.md", { doc_kind: "todos" }),
      ]),
    );
    flushSync();
    clickTab(4);
    expect(textOf(".group .value")).toEqual(["todo", "todos"]);
    expect(textOf(".group .count")).toEqual(["1", "2"]);
  });

  it("갈린 곳이 없으면 비었다고 말한다", () => {
    linkIndex.set(buildIndex([mkInfo("/v/a.md", { doc_kind: "plan" })]));
    flushSync();
    clickTab(4);
    expect(document.querySelector(".empty")).not.toBeNull();
  });
});
