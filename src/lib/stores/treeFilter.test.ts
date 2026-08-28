import { describe, it, expect } from "vitest";
import { filterEntries, countMatches, collectLeafPaths } from "./treeFilter";
import type { NoteEntry } from "$lib/tauri/notes";

/**
 * 사이드바 트리 필터 — **테스트가 0이었다.**
 *
 * 재귀 필터는 조용히 틀리기 좋은 자리다. 결과가 나오긴 하고, 빠진 것이 있는지는
 * 원본을 알아야만 안다.
 */

function file(name: string, path = `/v/${name}`): NoteEntry {
  return { name, path, is_dir: false } as unknown as NoteEntry;
}
function dir(name: string, children: NoteEntry[], path = `/v/${name}`): NoteEntry {
  return { name, path, is_dir: true, children } as unknown as NoteEntry;
}

const TREE: NoteEntry[] = [
  dir("plans", [file("alpha.md", "/v/plans/alpha.md"), file("beta.md", "/v/plans/beta.md")]),
  dir("reference", [file("gamma.md", "/v/reference/gamma.md")]),
  file("HOME.md"),
];

describe("filterEntries", () => {
  it("빈 질의는 원본 그대로 — 사본도 안 만든다", () => {
    expect(filterEntries(TREE, "")).toBe(TREE);
    expect(filterEntries(TREE, "   ")).toBe(TREE);
  });

  it("파일 이름으로 거른다", () => {
    const out = filterEntries(TREE, "alpha");
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("plans");
    expect(out[0].children?.map((c) => c.name)).toEqual(["alpha.md"]);
  });

  it("대소문자를 안 가린다", () => {
    expect(filterEntries(TREE, "ALPHA")[0].children?.[0].name).toBe("alpha.md");
  });

  /** 매칭된 자손이 있으면 부모 체인이 살아남아야 한다 — 안 그러면 트리가 아니라 목록이 된다. */
  it("매칭된 자손의 부모가 살아남는다", () => {
    const deep = [dir("a", [dir("b", [file("target.md", "/v/a/b/target.md")])])];
    const out = filterEntries(deep, "target");
    expect(out[0].name).toBe("a");
    expect(out[0].children?.[0].name).toBe("b");
    expect(out[0].children?.[0].children?.[0].name).toBe("target.md");
  });

  it("원본을 안 건드린다", () => {
    filterEntries(TREE, "alpha");
    expect(TREE[0].children).toHaveLength(2);
  });

  /**
   * ⚠️ **폴더 이름이 맞으면 그 안이 곧 찾던 것이다.** 예전엔 children 을 필터 결과(=빈
   * 배열)로 갈아 끼워 **빈 폴더 한 줄**이 떴다.
   */
  it("폴더 이름이 맞으면 하위를 통째로 남긴다", () => {
    const out = filterEntries(TREE, "plans");
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("plans");
    expect(out[0].children?.map((c) => c.name)).toEqual(["alpha.md", "beta.md"]);
  });

  /** 자손만 맞으면 그때는 걸러진 것만 남는다 — 두 규칙이 섞이면 안 된다. */
  it("자손만 맞으면 걸러진 자식만", () => {
    const out = filterEntries(TREE, "alpha");
    expect(out[0].children?.map((c) => c.name)).toEqual(["alpha.md"]);
  });
});

describe("countMatches", () => {
  it("잎(파일)만 센다", () => {
    expect(countMatches(filterEntries(TREE, "alpha"))).toBe(1);
    expect(countMatches(filterEntries(TREE, ".md"))).toBe(4);
  });

  /**
   * 🔴 **화면에 줄이 보이는데 개수는 0이다.**
   *
   * `filterEntries("plans")` 는 `plans/` 폴더 한 줄을 낸다(자식은 빈다). 그런데
   * `countMatches` 는 **잎만** 세므로 0이다. 사이드바는 "0 matches"라고 쓰면서 줄을
   * 그린다 — 둘 중 하나는 거짓말이고, 에러는 없다.
   *
   * 사용자가 폴더 이름으로 검색하는 것은 자연스러운 조작이라(`plans` 라고 치면
   * plans 폴더가 보고 싶다) 드물지도 않다.
   */
  it("폴더만 맞았을 때 개수와 화면이 어긋나지 않는다", () => {
    const filtered = filterEntries(TREE, "plans");
    const visibleRows = filtered.length;
    expect(visibleRows).toBeGreaterThan(0);
    expect(
      countMatches(filtered),
      "줄은 보이는데 개수가 0이면 둘 중 하나가 거짓말이다",
    ).toBeGreaterThan(0);
  });

  it("빈 목록은 0", () => {
    expect(countMatches([])).toBe(0);
  });
});

describe("collectLeafPaths", () => {
  it("표시 순서대로 잎 경로만 모은다", () => {
    expect(collectLeafPaths(filterEntries(TREE, ".md"))).toEqual([
      "/v/plans/alpha.md",
      "/v/plans/beta.md",
      "/v/reference/gamma.md",
      "/v/HOME.md",
    ]);
  });

  /** ⚠️ 키보드 ↑↓ 가 이 배열을 쓴다 — 폴더가 섞이면 Enter 가 폴더를 열려고 한다. */
  it("폴더는 안 넣는다", () => {
    expect(collectLeafPaths(TREE).some((p) => p.endsWith("/plans"))).toBe(false);
  });
});
