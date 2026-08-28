import { describe, it, expect } from "vitest";
import { entryPath, scopeCandidates, inPaletteScope, type PaletteResult } from "./palette";

/**
 * 팔레트의 **스코프**.
 *
 * v3.1.0 이 필터 뷰·CLI·MCP 에 `under` 를 넣었지만 팔레트는 **일회성 폴더 칩**(전문 모드
 * 한정)뿐이었다. 게다가 그 칩은 **정확 일치**로 걸렀다 — 다른 표면은 전부 **문자열
 * 접두사**다(`inScope` · `under` · `exclude`).
 *
 * ⚠️ 규칙이 갈리면 같은 문자열이 표면마다 다르게 먹는다. `knowledge/lapis` 로 좁혔을 때
 * 팔레트만 `knowledge/lapis/plans/a.md` 를 빼놓는다 — 결과는 나오고 **에러는 없다.**
 */

const res = (kind: string, path: string): PaletteResult =>
  ({ entry: { kind, path, label: path, name: path, snippet: "" }, score: 1 }) as unknown as PaletteResult;

describe("entryPath", () => {
  it("경로를 가진 종류에서 경로를 낸다", () => {
    for (const k of ["note", "content", "recent", "changed"]) {
      expect(entryPath(res(k, "a/b.md").entry), k).toBe("a/b.md");
    }
  });

  /** ⚠️ 명령·태그·facet 은 경로가 없다 — 스코프가 이것들을 지우면 안 된다. */
  it("경로가 없는 종류는 null", () => {
    expect(entryPath({ kind: "tag", key: "t", display: "t", mode: "leaf", count: 1 } as never)).toBeNull();
    expect(entryPath({ kind: "facet", field: "topic", value: "x", count: 1 } as never)).toBeNull();
  });
});

describe("inPaletteScope", () => {
  it("스코프가 없으면 전부 통과", () => {
    expect(inPaletteScope(res("note", "a/b.md").entry, null)).toBe(true);
  });

  /** 🔴 **접두사**다 — 다른 표면과 같은 규칙. */
  it("하위까지 통과시킨다", () => {
    expect(inPaletteScope(res("note", "knowledge/lapis/plans/a.md").entry, "knowledge/lapis/")).toBe(
      true,
    );
    expect(inPaletteScope(res("note", "knowledge/slate/a.md").entry, "knowledge/lapis/")).toBe(false);
  });

  it("세그먼트 중간에서 끊는 접두사도 먹는다", () => {
    expect(inPaletteScope(res("note", "plans/lapis-cli-x.md").entry, "plans/lapis-cli-")).toBe(true);
  });

  /**
   * ⚠️ **경로가 없는 항목은 스코프가 안 지운다.** 폴더를 좁혔다고 `>` 명령이나 태그가
   * 사라지면, 스코프를 켠 사용자는 명령 팔레트를 쓸 수 없게 된다.
   */
  it("경로 없는 항목은 스코프와 무관하게 남는다", () => {
    const tag = { kind: "tag", key: "t", display: "t", mode: "leaf", count: 1 } as never;
    expect(inPaletteScope(tag, "knowledge/lapis/")).toBe(true);
  });
});

describe("scopeCandidates", () => {
  const results = [
    res("content", "knowledge/lapis/plans/a.md"),
    res("note", "knowledge/lapis/reference/b.md"),
    res("recent", "knowledge/slate/plans/c.md"),
    res("changed", "knowledge/slate/reference/d.md"),
  ];

  /**
   * ⚠️ **경로를 가진 종류 전부**에서 뽑는다. `folderChips` 는 본문 결과만 세는데(질의가
   * 찾아낸 것만), 스코프는 **지금 보이는 것**을 기준으로 골라야 한다 — 안 그러면
   * 화면에 있는 폴더가 후보에 없다.
   */
  it("보이는 결과 전부에서 후보를 뽑는다", () => {
    expect(scopeCandidates(results).map((c) => c.prefix)).toContain("knowledge/lapis/");
    expect(scopeCandidates(results).map((c) => c.prefix)).toContain("knowledge/slate/");
  });

  it("개수를 함께 낸다", () => {
    const lapis = scopeCandidates(results).find((c) => c.prefix === "knowledge/lapis/");
    expect(lapis!.count).toBe(2);
  });

  /** 전부를 덮는 후보는 아무것도 안 거른다 — `scopeOptions` 와 같은 규칙. */
  it("전부를 덮는 후보는 안 낸다", () => {
    expect(scopeCandidates(results).map((c) => c.prefix)).not.toContain("knowledge/");
  });

  it("경로 없는 결과가 섞여도 안 죽는다", () => {
    const mixed = [
      ...results,
      { entry: { kind: "command", command: { id: "x", label: "x" }, strong: false }, score: 1 },
    ] as unknown as PaletteResult[];
    expect(scopeCandidates(mixed).length).toBeGreaterThan(0);
  });

  it("빈 결과면 후보도 없다", () => {
    expect(scopeCandidates([])).toEqual([]);
  });

  /** 상한 — 칩이 벽이 되면 결과를 밀어낸다. */
  it("상한을 넘으면 자른다", () => {
    const many = Array.from({ length: 20 }, (_, i) => [
      res("note", `d${i}/a.md`),
      res("note", `d${i}/b.md`),
    ]).flat();
    expect(scopeCandidates(many, 6)).toHaveLength(6);
  });
});
