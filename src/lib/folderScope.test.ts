import { describe, it, expect } from "vitest";
import { inScope, passesScope, scopeOptions, normalizeScope } from "./folderScope";

/**
 * 폴더 스코프.
 *
 * ⚠️ 여기서 조용히 틀리는 방법은 **포함과 제외가 다른 규칙을 쓰는 것**이다. `exclude` 는
 * 문자열 접두사이고 그 이유가 `mcp/query.ts` 에 적혀 있다(디렉터리 경계로 맞추면
 * 세그먼트 중간 접두사가 no-op 이 된다). 둘이 갈리면 같은 문자열이 한쪽에서만 먹는다.
 */

describe("inScope", () => {
  it("빈 스코프는 전부 통과", () => {
    expect(inScope("a/b.md", [])).toBe(true);
  });

  it("접두사가 맞으면 통과", () => {
    expect(inScope("knowledge/lapis/x.md", ["knowledge/lapis/"])).toBe(true);
    expect(inScope("knowledge/slate/x.md", ["knowledge/lapis/"])).toBe(false);
  });

  /** ⚠️ 디렉터리 경계가 아니라 **문자열** 접두사다 — `exclude` 와 같은 규칙. */
  it("세그먼트 중간에서 끊는 접두사도 먹는다", () => {
    expect(inScope("plans/lapis-cli-layer4.md", ["plans/lapis-cli-"])).toBe(true);
  });

  it("여럿이면 하나만 맞아도 통과 (OR)", () => {
    const under = ["knowledge/lapis/", "knowledge/slate/"];
    expect(inScope("knowledge/slate/x.md", under)).toBe(true);
    expect(inScope("other/x.md", under)).toBe(false);
  });
});

describe("passesScope — 제외가 이긴다", () => {
  /**
   * ⚠️ 아카이브를 빼 두고 그 안을 스코프로 잡았을 때 아카이브가 딸려 나오면
   * **뺀 뜻이 사라진다.** "빼라"가 "여기서만"보다 강하다.
   */
  it("스코프 안이어도 제외되면 탈락", () => {
    expect(passesScope("_memories/a.md", ["_memories/"], ["_memories"])).toBe(false);
  });

  it("제외에 안 걸리고 스코프 안이면 통과", () => {
    expect(passesScope("knowledge/lapis/a.md", ["knowledge/"], ["_memories"])).toBe(true);
  });

  it("스코프가 비어도 제외는 먹는다", () => {
    expect(passesScope("_memories/a.md", [], ["_memories"])).toBe(false);
    expect(passesScope("other/a.md", [], ["_memories"])).toBe(true);
  });
});

describe("scopeOptions", () => {
  const paths = [
    "knowledge/lapis/reference/a.md",
    "knowledge/lapis/plans/b.md",
    "knowledge/slate/reference/c.md",
    "knowledge/slate/plans/d.md",
    "HOME.md",
  ];

  it("2단계까지의 디렉터리를 개수와 함께 낸다", () => {
    expect(scopeOptions(paths)).toEqual([
      // 5중 4 — `HOME.md` 를 실제로 거르므로 쓸모 있는 후보다.
      { prefix: "knowledge/", label: "knowledge/", count: 4 },
      { prefix: "knowledge/lapis/", label: "knowledge/lapis/", count: 2 },
      { prefix: "knowledge/slate/", label: "knowledge/slate/", count: 2 },
    ]);
  });

  /**
   * ⚠️ **전부를 덮는 후보만 뺀다.** 눌러도 화면이 안 바뀌는 항목은 고장과 구별이 안 된다.
   * 반대로 하나라도 거르면(위의 `knowledge/` 는 `HOME.md` 를 뺀다) 남긴다 — "두 프로젝트
   * 전부"가 유효한 선택지이기 때문이다.
   */
  it("전부를 덮는 후보는 뺀다", () => {
    const all = ["knowledge/a/x.md", "knowledge/b/y.md"];
    expect(scopeOptions(all).map((o) => o.prefix)).not.toContain("knowledge/");
  });

  it("일부만 덮으면 남긴다", () => {
    expect(scopeOptions(paths).map((o) => o.prefix)).toContain("knowledge/");
  });

  /** 하나뿐인 후보는 필터가 아니라 파일 열기다. */
  it("노트 하나짜리 후보는 뺀다", () => {
    const one = [...paths, "solo/only/z.md"];
    expect(scopeOptions(one).map((o) => o.prefix)).not.toContain("solo/");
  });

  /**
   * 🔴 **호출부는 절대경로를 넘긴다.** `FilterPanel` 은 `idx.byPath.keys()`,
   * 팔레트는 `entryPath()` — 둘 다 `C:/…/vault/…` 또는 `/Users/…/vault/…` 다.
   *
   * 위 단언들이 vault 상대경로만 먹였기 때문에 이 함수는 **테스트에서만 동작했다.**
   * 절대경로를 주면 depth 2 예산을 드라이브·홈이 다 먹어 후보가 전부 `n < total` 에
   * 걸리고, 폴더 칩과 팔레트 스코프 칩이 **에러 없이 하나도 안 뜬다.**
   */
  it("절대경로를 받아도 vault 아래에서 후보를 낸다", () => {
    const abs = [
      "C:/Projects/vault/knowledge/lapis/a.md",
      "C:/Projects/vault/knowledge/lapis/b.md",
      "C:/Projects/vault/knowledge/slate/c.md",
      "C:/Projects/vault/HOME.md",
    ];
    const opts = scopeOptions(abs);
    // 매칭은 `startsWith` 이므로 접두사는 **절대경로 그대로** 나와야 한다.
    expect(opts.map((o) => o.prefix)).toEqual([
      "C:/Projects/vault/knowledge/",
      "C:/Projects/vault/knowledge/lapis/",
    ]);
    // 화면에 드라이브를 보여줄 이유는 없다 — 공통 뿌리를 걷은 이름을 같이 낸다.
    expect(opts.map((o) => o.label)).toEqual(["knowledge/", "knowledge/lapis/"]);
  });

  it("POSIX 절대경로도 같다", () => {
    const abs = [
      "/Users/me/vault/plans/a.md",
      "/Users/me/vault/plans/b.md",
      "/Users/me/vault/HOME.md",
    ];
    expect(scopeOptions(abs)).toEqual([
      { prefix: "/Users/me/vault/plans/", label: "plans/", count: 2 },
    ]);
  });

  /**
   * ⚠️ **양쪽 머신에서 같아야 한다.** vault 는 Windows 에서 `C:/…`, macOS 에서 `/Users/…`
   * 또는 `/Volumes/…`(이 저장소의 asset 스코프가 명시하는 경로) 아래 있다. 뿌리를 걷는
   * 방식이라 모양에 안 기대지만, 한쪽만 통과하는 상태가 생기지 않게 못 박아 둔다.
   */
  it("macOS 외장 볼륨 경로도 같다", () => {
    const abs = [
      "/Volumes/Source/SharedDocs/knowledge/lapis/a.md",
      "/Volumes/Source/SharedDocs/knowledge/lapis/b.md",
      "/Volumes/Source/SharedDocs/knowledge/slate/c.md",
      "/Volumes/Source/SharedDocs/HOME.md",
    ];
    expect(scopeOptions(abs)).toEqual([
      { prefix: "/Volumes/Source/SharedDocs/knowledge/", label: "knowledge/", count: 3 },
      { prefix: "/Volumes/Source/SharedDocs/knowledge/lapis/", label: "knowledge/lapis/", count: 2 },
    ]);
  });

  /** Windows UNC — 앞의 빈 세그먼트 둘이 뿌리에 그대로 들어간다. */
  it("UNC 경로도 같다", () => {
    const abs = [
      "//nas/share/vault/plans/a.md",
      "//nas/share/vault/plans/b.md",
      "//nas/share/vault/HOME.md",
    ];
    expect(scopeOptions(abs)).toEqual([
      { prefix: "//nas/share/vault/plans/", label: "plans/", count: 2 },
    ]);
  });

  /** 상대경로에서는 걷을 뿌리가 없다 — label 이 prefix 와 같다. */
  it("상대경로면 label 이 prefix 와 같다", () => {
    expect(scopeOptions(paths)[0]).toEqual({
      prefix: "knowledge/",
      label: "knowledge/",
      count: 4,
    });
  });

  it("루트 직속 파일은 후보를 안 만든다", () => {
    expect(scopeOptions(["a.md", "b.md", "c.md"])).toEqual([]);
  });

  it("개수 내림차순, 동점은 경로순", () => {
    const p = [
      "z/1/a.md", "z/1/b.md", "z/1/c.md",
      "a/1/d.md", "a/1/e.md",
      "m/1/f.md", "m/1/g.md",
    ];
    expect(scopeOptions(p, 1).map((o) => o.prefix)).toEqual(["z/", "a/", "m/"]);
  });
});

describe("normalizeScope", () => {
  it("앞의 슬래시와 ./ 를 걷는다", () => {
    expect(normalizeScope("/knowledge/lapis")).toBe("knowledge/lapis");
    expect(normalizeScope("./knowledge/lapis")).toBe("knowledge/lapis");
  });

  it("역슬래시를 슬래시로", () => {
    expect(normalizeScope("knowledge\\lapis")).toBe("knowledge/lapis");
  });

  /**
   * ⚠️ 끝에 `/` 를 **붙이지 않는다.** 붙이면 세그먼트 중간 접두사가 죽는다
   * (`plans/lapis-cli-` → `plans/lapis-cli-/` 는 아무것도 안 맞는다).
   */
  it("끝에 슬래시를 붙이지 않는다", () => {
    expect(normalizeScope("plans/lapis-cli-")).toBe("plans/lapis-cli-");
    expect(normalizeScope("knowledge/lapis")).toBe("knowledge/lapis");
  });

  it("공백만이면 빈 문자열", () => {
    expect(normalizeScope("   ")).toBe("");
  });
});
