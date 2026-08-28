import { describe, it, expect } from "vitest";
import { buildTagIndex } from "./tags";
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

describe("prefix 색인", () => {
  /**
   * ⚠️ **마지막 조각은 접두사가 아니다.** `a/b/c` 는 `a` 와 `a/b` 만 접두사 색인에
   * 들어간다 — `a/b/c` 자체는 leaf 색인(`byTag`)의 몫이다.
   *
   * 코드 주석이 오래 "셋 다 넣는다"고 적고 있었다. 그대로 믿고 루프를 `<=` 로 "고치면"
   * `prefixCounts` 가 늘어나고 `rootPrefixes` 정렬이 흔들린다 — 화면은 그려지고
   * 숫자만 달라진다.
   */
  it("마지막 조각은 접두사 색인에 안 들어간다", () => {
    const idx = buildTagIndex([note("/a.md", ["feature/bubble/creation"])]);
    expect([...idx.byPrefix.keys()].sort()).toEqual(["feature", "feature/bubble"]);
    expect(idx.byTag.has("feature/bubble/creation")).toBe(true);
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

  it("평면 태그는 접두사가 아니다", () => {
    const idx = buildTagIndex([note("/a.md", ["bug"])]);
    expect(idx.byPrefix.size).toBe(0);
    expect(idx.flatTags).toContain("bug");
  });
});

describe("prefix 트리 — 알려진 한계", () => {
  /**
   * ⚠️ **직계 자식만 1단계 담는다.** `feature/bubble/creation` 은
   * `prefixChildren["feature"]` 에 `feature/bubble` 로만 들어가고, 3단계 칩은 없다.
   *
   * 그래서 3단계 태그는 `feature/bubble` 을 **접두사로** 눌러야만 닿는다.
   */
  it("자식은 2단계까지만 담긴다", () => {
    const idx = buildTagIndex([note("/a.md", ["feature/bubble/creation"])]);
    expect(idx.prefixChildren.get("feature")).toEqual(["feature/bubble"]);
  });

  /**
   * 🟡 **잠재 결함 — 지금 이 vault 에서는 안 터진다.**
   *
   * 태그가 **정확 태그이면서 동시에 상위 접두사**이면(`feature/bubble` 이 그 자체로도
   * 붙어 있고 `feature/bubble/creation` 도 있는 경우), `TagPanel` 의
   * `isSubPrefix = prefixCounts>0 && !byTag.has(key)` 가 **false** 가 되어 leaf 로
   * 선택된다. 그러면 깊은 노트는 3단계 칩도 없고 접두사 선택도 안 돼서 **트리에서 닿을
   * 수 없다.** 화면은 멀쩡하고 개수만 적다.
   *
   * 이 테스트는 그 조건이 실제로 만들어지는 것을 **고정**한다 — 고칠 때 재현 지점이 된다.
   * (2026-08-28 실측: 이 vault 는 깊이 3 태그가 0개, 이 형태도 0건이라 아직 안 터진다.)
   */
  it("정확 태그이면서 상위 접두사인 조건이 실제로 생긴다", () => {
    const idx = buildTagIndex([
      note("/a.md", ["feature/bubble"]),
      note("/b.md", ["feature/bubble/creation"]),
    ]);
    const key = "feature/bubble";
    expect(idx.byTag.has(key), "정확 태그로 존재").toBe(true);
    expect(idx.prefixCounts.get(key), "동시에 상위 접두사").toBe(1);
    // TagPanel 의 판정을 그대로 재현한다.
    const isSubPrefix = (idx.prefixCounts.get(key) ?? 0) > 0 && !idx.byTag.has(key);
    expect(isSubPrefix, "leaf 로 선택되어 깊은 노트를 못 본다").toBe(false);
    // 접두사로 보면 둘 다 보인다 — 즉 정보는 있는데 UI 가 안 쓴다.
    expect(idx.byPrefix.get(key)?.size).toBe(1);
  });
});
