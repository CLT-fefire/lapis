import { describe, it, expect } from "vitest";
import {
  buildIndex,
  resolveTarget,
  targetName,
  splitAnchor,
  resolveWikilink,
} from "./linkIndex";
import { findHeadingByAnchor } from "./stores/outline";
import type { HeadingInfo } from "$lib/markdownPlugins/headingAnchor";
import { findBrokenLinks } from "./brokenLinks";
import type { LinkInfo } from "$lib/tauri/notes";

/**
 * 위키링크의 헤딩 앵커 — `[[노트#헤딩]]`.
 *
 * ## ⚠️ 왜 이게 조용히 틀리던 것인가
 *
 * 마크다운 링크는 이미 앵커를 뗀다(Rust `extract_md_links`가 `#`·`?`를 자른다).
 * 위키링크만 안 뗐다. 그래서 `[[노트#헤딩]]`은:
 *
 * - 해소가 안 돼 **끊긴 링크로 보고**되고 (노트는 멀쩡히 있는데)
 * - 백링크 인덱스에 안 들어가서 **간선이 통째로 사라진다**
 *
 * 둘 다 에러가 아니다. 링크가 회색으로 보이고 백링크 목록이 한 줄 짧을 뿐이다.
 */

const mk = (path: string, extra: Partial<LinkInfo> = {}): LinkInfo => {
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

describe("splitAnchor", () => {
  it("이름과 앵커를 가른다", () => {
    expect(splitAnchor("노트#헤딩")).toEqual({ name: "노트", anchor: "헤딩" });
  });

  it("앵커가 없으면 anchor 는 null", () => {
    expect(splitAnchor("노트")).toEqual({ name: "노트", anchor: null });
  });

  /** `[[#헤딩]]` — 같은 문서 안. 이름이 빈 문자열이다. */
  it("이름 없이 앵커만 올 수 있다", () => {
    expect(splitAnchor("#헤딩")).toEqual({ name: "", anchor: "헤딩" });
  });

  /** 헤딩 텍스트에 `#`이 또 있을 수 있다. 첫 번째에서만 가른다. */
  it("첫 번째 # 에서만 가른다", () => {
    expect(splitAnchor("노트#C# 이야기")).toEqual({ name: "노트", anchor: "C# 이야기" });
  });

  it("앞뒤 공백을 턴다", () => {
    expect(splitAnchor(" 노트 # 헤딩 ")).toEqual({ name: "노트", anchor: "헤딩" });
  });
});

describe("targetName — 앵커는 여기서 떼지 않는다", () => {
  /**
   * ⚠️ **일부러 안 뗀다.** 여기서 떼면 `[[C#]]`이 `C`가 되어, `C#.md`가 있어도 영영
   * 그 노트로 못 간다. 앵커 처리는 `resolverKey`가 **찾아보고 없을 때만** 한다.
   */
  it("별칭만 뗀다", () => {
    expect(targetName("노트#헤딩|별칭")).toBe("노트#헤딩");
  });

  /** 순서가 있다 — 오비시디언 문법은 `[[노트#헤딩|별칭]]` 이라 별칭이 뒤다. */
  it("별칭 안의 # 은 이름에 영향을 주지 않는다", () => {
    expect(targetName("노트|C# 별칭")).toBe("노트");
  });

  it("떼고 나면 앵커 폴백이 받는다", () => {
    const idx = buildIndex([mk("/v/노트.md"), mk("/v/다른.md")]);
    expect(resolveTarget(targetName("노트#헤딩|별칭"), idx, "/v/다른.md")).toBe("/v/노트.md");
  });
});

describe("해소", () => {
  const index = () => buildIndex([mk("/v/노트.md"), mk("/v/다른.md")]);

  it("앵커가 붙어도 노트로 간다", () => {
    expect(resolveTarget("노트#헤딩", index(), "/v/다른.md")).toBe("/v/노트.md");
  });

  /**
   * ⚠️ **이름에 `#`이 들어간 노트가 이긴다.** `C#.md` 가 있으면 `[[C#]]` 은 그 노트다 —
   * 먼저 통째로 찾아보고, 없을 때만 앵커를 떼고 다시 찾는다. 순서를 뒤집으면 이미
   * 잘 가던 링크가 조용히 다른 곳으로 간다.
   */
  it("이름에 # 이 있는 노트가 앵커 해석보다 먼저다", () => {
    const idx = buildIndex([mk("/v/C#.md"), mk("/v/C.md"), mk("/v/다른.md")]);
    expect(resolveTarget("C#", idx, "/v/다른.md")).toBe("/v/C#.md");
  });

  it("앵커만 있는 것은 해소하지 않는다 — 같은 문서 안이라 대상이 없다", () => {
    expect(resolveTarget("#헤딩", index(), "/v/다른.md")).toBeNull();
  });

  it("노트가 없으면 앵커를 떼도 여전히 없다", () => {
    expect(resolveTarget("없는노트#헤딩", index(), "/v/다른.md")).toBeNull();
  });
});

describe("⚠️ 간선이 사라지던 것", () => {
  const vault = () => [
    mk("/v/노트.md"),
    mk("/v/가리킨다.md", { targets: ["노트#헤딩"] }),
  ];

  it("앵커 링크도 백링크가 된다", () => {
    const idx = buildIndex(vault());
    expect([...(idx.backlinks.get("/v/노트.md") ?? [])]).toEqual(["/v/가리킨다.md"]);
  });

  it("앵커 링크는 끊긴 링크가 아니다", () => {
    expect(findBrokenLinks(buildIndex(vault()))).toEqual([]);
  });

  it("노트가 진짜 없으면 여전히 끊긴 링크다", () => {
    const idx = buildIndex([mk("/v/가리킨다.md", { targets: ["없는것#헤딩"] })]);
    expect(findBrokenLinks(idx).map((g) => g.target)).toEqual(["없는것#헤딩"]);
  });
});

describe("resolveWikilink — 어디로 갈지와 어디로 스크롤할지", () => {
  const idx = () => buildIndex([mk("/v/노트.md"), mk("/v/C#.md"), mk("/v/여기.md")]);

  it("앵커 없는 링크", () => {
    expect(resolveWikilink("노트", idx(), "/v/여기.md")).toEqual({
      path: "/v/노트.md",
      anchor: null,
      sameDoc: false,
    });
  });

  it("노트 + 앵커", () => {
    expect(resolveWikilink("노트#어떤 헤딩", idx(), "/v/여기.md")).toEqual({
      path: "/v/노트.md",
      anchor: "어떤 헤딩",
      sameDoc: false,
    });
  });

  /**
   * ⚠️ **`#`이 이름의 일부일 때 앵커로 오해하지 않는다.** `C#.md`가 있으면 `[[C#]]`은
   * 그 노트로 가고 스크롤 요청은 없다. 여기서 틀리면 맞는 노트에 가서 없는 헤딩을
   * 찾다가 아무 일도 안 일어난 것처럼 보인다.
   */
  it("이름에 # 이 있으면 앵커가 아니다", () => {
    expect(resolveWikilink("C#", idx(), "/v/여기.md")).toEqual({
      path: "/v/C#.md",
      anchor: null,
      sameDoc: false,
    });
  });

  it("이름 없이 앵커만이면 같은 문서다", () => {
    expect(resolveWikilink("#헤딩", idx(), "/v/여기.md")).toEqual({
      path: null,
      anchor: "헤딩",
      sameDoc: true,
    });
  });

  it("노트가 없으면 같은 문서가 아니라 그냥 못 간다", () => {
    expect(resolveWikilink("없는것#헤딩", idx(), "/v/여기.md")).toEqual({
      path: null,
      anchor: "헤딩",
      sameDoc: false,
    });
  });
});

describe("findHeadingByAnchor", () => {
  const h = (text: string, slug: string): HeadingInfo => ({
    level: 2,
    text,
    slug,
    line: 0,
  });
  const HS = [h("어떤 헤딩", "어떤-헤딩"), h("Another One", "another-one")];

  /** 사람이 쓰는 것은 slug가 아니라 **헤딩 글자 그대로**다. */
  it("헤딩 텍스트로 찾는다", () => {
    expect(findHeadingByAnchor(HS, "어떤 헤딩")?.slug).toBe("어떤-헤딩");
  });

  it("slug 를 그대로 써도 찾는다", () => {
    expect(findHeadingByAnchor(HS, "another-one")?.text).toBe("Another One");
  });

  it("대소문자는 안 따진다", () => {
    expect(findHeadingByAnchor(HS, "ANOTHER ONE")?.slug).toBe("another-one");
  });

  /** ⚠️ 없으면 null 이다. 아무거나 고르면 엉뚱한 데로 스크롤한다. */
  it("없으면 null", () => {
    expect(findHeadingByAnchor(HS, "없는 헤딩")).toBeNull();
  });
});
