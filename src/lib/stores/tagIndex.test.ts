import { describe, it, expect } from "vitest";
import { buildTagIndex } from "../tagIndex";
import type { LinkInfo } from "$lib/tauri/notes";

/**
 * 태그 색인 — **테스트가 0이었다.**
 *
 * 중첩 태그(`a/b/c`)의 접두사 색인은 off-by-one 이 살기 좋은 자리다. 틀려도 결과가
 * 나오긴 하고, 빠진 노트가 있는지는 원본을 알아야 안다.
 */

function note(path: string, tags: string[]): LinkInfo {
  return {
    source_path: path,
    source_name: path.split("/").pop()!,
    title: null,
    doc_kind: null,
    topic: null,
    tags,
    targets: [],
    related: [],
    props: {},
  } as unknown as LinkInfo;
}

describe("leaf 색인", () => {
  it("정확한 태그로 노트를 찾는다", () => {
    const idx = buildTagIndex([note("/a.md", ["feature/bubble"]), note("/b.md", ["bug"])]);
    expect([...(idx.byTag.get("feature/bubble") ?? [])]).toEqual(["/a.md"]);
    expect([...(idx.byTag.get("bug") ?? [])]).toEqual(["/b.md"]);
  });

  it("키는 소문자로 정규화한다", () => {
    const idx = buildTagIndex([note("/a.md", ["Feature"]), note("/b.md", ["feature"])]);
    expect(idx.byTag.get("feature")?.size).toBe(2);
  });

  /** 표시는 **가장 자주 쓰인 케이스**를 따른다 — 사용자가 실제로 쓰는 표기가 이긴다. */
  it("표시 케이스는 최빈값", () => {
    const idx = buildTagIndex([
      note("/a.md", ["Feature"]),
      note("/b.md", ["feature"]),
      note("/c.md", ["feature"]),
    ]);
    expect(idx.display.get("feature")).toBe("feature");
  });
});

describe("prefix 색인 — MCP 와 같은 규칙", () => {
  /**
   * 🔴 **자기 자신이 들어가야 한다.** MCP 의 태그 질의는
   * `n === t || n.startsWith(t + "/")` — **정확 일치 ∪ 하위**다.
   *
   * 앱이 자기 자신을 빼면 같은 태그를 물었을 때 **앱과 MCP 가 다른 집합**을 낸다.
   * 정확히 태그된 노트가 앱의 접두사 선택에서만 사라지고, 에러는 없다.
   */
  it("자기 자신도 접두사 색인에 들어간다", () => {
    const idx = buildTagIndex([note("/a.md", ["feature/bubble/creation"])]);
    expect([...idx.byPrefix.keys()].sort()).toEqual([
      "feature",
      "feature/bubble",
      "feature/bubble/creation",
    ]);
  });

  /** MCP 규칙을 그대로 재현해 두 구현이 같은 집합을 내는지 본다. */
  it("MCP 규칙과 같은 집합을 낸다", () => {
    const tags: Record<string, string[]> = {
      "/a.md": ["feature/bubble"],
      "/b.md": ["feature/bubble/creation"],
      "/c.md": ["feature"],
      "/d.md": ["featureless"],
    };
    const idx = buildTagIndex(Object.entries(tags).map(([p, t]) => note(p, t)));
    const mcp = (t: string) =>
      Object.entries(tags)
        .filter(([, ts]) => ts.some((x) => x === t || x.startsWith(t + "/")))
        .map(([p]) => p)
        .sort();

    for (const t of ["feature", "feature/bubble", "feature/bubble/creation"]) {
      expect([...(idx.byPrefix.get(t) ?? [])].sort(), `태그 ${t}`).toEqual(mcp(t));
    }
  });

  /** ⚠️ `featureless` 가 `feature` 에 딸려 오면 안 된다 — 경계는 `/` 다. */
  it("이름이 겹치는 다른 태그는 안 딸려 온다", () => {
    const idx = buildTagIndex([note("/a.md", ["feature"]), note("/b.md", ["featureless"])]);
    expect([...(idx.byPrefix.get("feature") ?? [])]).toEqual(["/a.md"]);
  });

  it("접두사는 하위 노트를 전부 모은다", () => {
    const idx = buildTagIndex([
      note("/a.md", ["feature/bubble"]),
      note("/b.md", ["feature/graph"]),
      note("/c.md", ["bug"]),
    ]);
    expect(idx.byPrefix.get("feature")?.size).toBe(2);
    expect(idx.prefixCounts.get("feature")).toBe(2);
  });

  it("같은 노트가 두 번 세어지지 않는다", () => {
    const idx = buildTagIndex([note("/a.md", ["feature/bubble", "feature/graph"])]);
    expect(idx.prefixCounts.get("feature")).toBe(1);
  });

  it("평면 태그는 flatTags 에 남는다", () => {
    const idx = buildTagIndex([note("/a.md", ["bug"])]);
    expect(idx.flatTags).toContain("bug");
  });
});

describe("prefix 트리 — 모든 단계", () => {
  /**
   * 🔴 예전엔 **root 의 1-depth 만** 담았다. `feature/bubble/creation` 은
   * `prefixChildren["feature"] = ["feature/bubble"]` 로만 들어가고 3단계 칩이 없었다.
   */
  it("모든 단계의 직계 자식을 담는다", () => {
    const idx = buildTagIndex([note("/a.md", ["feature/bubble/creation"])]);
    expect(idx.prefixChildren.get("feature")).toEqual(["feature/bubble"]);
    expect(idx.prefixChildren.get("feature/bubble")).toEqual(["feature/bubble/creation"]);
  });

  it("잎은 자식이 없다", () => {
    const idx = buildTagIndex([note("/a.md", ["feature/bubble"])]);
    expect(idx.prefixChildren.get("feature/bubble")).toBeUndefined();
  });

  /**
   * 🔴 **정확 태그이면서 동시에 상위 접두사**인 경우 — 예전엔 여기서 깊은 노트에
   * 닿을 수 없었다. `TagPanel` 의 `isSubPrefix` 가 `prefixCounts>0 && !byTag.has(key)`
   * 라서 false 가 되어 leaf 로 골랐고, 3단계 칩도 없었다.
   *
   * 이제 판정이 **"자식이 있는가"** 이고 `byPrefix` 가 자기 자신을 포함하므로,
   * 접두사로 골라도 정확히 태그된 노트가 빠지지 않는다.
   */
  it("정확 태그를 겸해도 깊은 노트에 닿는다", () => {
    const idx = buildTagIndex([
      note("/a.md", ["feature/bubble"]),
      note("/b.md", ["feature/bubble/creation"]),
    ]);
    const key = "feature/bubble";

    // TagPanel 의 새 판정을 그대로 재현한다.
    const isSubPrefix = (idx.prefixChildren.get(key)?.length ?? 0) > 0;
    expect(isSubPrefix, "자식이 있으므로 접두사로 고른다").toBe(true);

    // 접두사로 고르면 **둘 다** 나온다 — 정확히 태그된 것도 빠지지 않는다.
    expect([...(idx.byPrefix.get(key) ?? [])].sort()).toEqual(["/a.md", "/b.md"]);
  });
});
