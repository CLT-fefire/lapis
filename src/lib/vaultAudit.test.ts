import { describe, it, expect } from "vitest";
import { buildIndex } from "./linkIndex";
import { findOrphans, findTagIssues, findAmbiguousNames } from "./vaultAudit";
import type { LinkInfo } from "$lib/tauri/notes";

function mkInfo(path: string, extra: Partial<LinkInfo> = {}): LinkInfo {
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
}

/**
 * 고아 = **들어오는 링크가 없는 노트**. 본문 위키링크와 프론트매터 교차참조를 **둘 다** 본다.
 *
 * 백링크가 이 앱의 주된 이동 수단이라, 들어오는 링크가 없는 노트는 사실상 닿을 수 없다.
 * 끊긴 링크 감사의 정확한 거울상이다.
 */
describe("고아 노트", () => {
  it("아무도 안 가리키는 노트를 찾는다", () => {
    const idx = buildIndex([
      mkInfo("/v/hub.md", { targets: ["seen"] }),
      mkInfo("/v/seen.md"),
      mkInfo("/v/lonely.md"),
    ]);
    expect(findOrphans(idx).map((o) => o.path).sort()).toEqual(["/v/hub.md", "/v/lonely.md"]);
  });

  /**
   * ⚠️ **나가는 링크가 적은 것이 위**다. 예전엔 경로순이라 진입점이 맨 위에 왔다 —
   * 실제 vault 의 `HOME.md` 는 나가는 링크가 19개인데 아무도 안 가리킨다(당연하다).
   * 첫 줄이 매번 "고칠 것 아님"이면 목록 전체를 덜 보게 된다.
   */
  it("진입점(나가는 링크가 많은 것)을 뒤로 보낸다", () => {
    const idx = buildIndex([
      mkInfo("/v/hub.md", { targets: ["seen", "other"] }),
      mkInfo("/v/seen.md"),
      mkInfo("/v/other.md"),
      mkInfo("/v/lonely.md"),
    ]);
    expect(findOrphans(idx).map((o) => o.path)).toEqual(["/v/lonely.md", "/v/hub.md"]);
  });

  /** ⚠️ 동점은 경로순 — 결정성이 없으면 같은 vault 가 매번 다른 답을 낸다. */
  it("나가는 링크 수가 같으면 경로순", () => {
    const idx = buildIndex([
      mkInfo("/v/z.md"),
      mkInfo("/v/a.md"),
      mkInfo("/v/m.md"),
    ]);
    expect(findOrphans(idx).map((o) => o.path)).toEqual(["/v/a.md", "/v/m.md", "/v/z.md"]);
  });

  /** 한쪽 채널만 보면 `related`로만 걸린 노트를 고아로 오판한다. */
  it("프론트매터 관계로만 들어와도 고아가 아니다", () => {
    const idx = buildIndex([
      mkInfo("/v/a.md", { props: { related: ["b"] } }),
      mkInfo("/v/b.md"),
    ]);
    expect(findOrphans(idx).map((o) => o.path)).toEqual(["/v/a.md"]);
  });

  /**
   * ⚠️ 진입점 오탐을 새 개념 없이 가르는 수단이다. 허브는 나가는 링크가 많고 떨어진 섬은
   * 적다 — 두 숫자를 나란히 보여주면 사람이 바로 구분한다.
   */
  it("나가는 링크 수를 함께 낸다", () => {
    const idx = buildIndex([
      mkInfo("/v/home.md", { targets: ["a", "b"], props: { related: ["c"] } }),
      mkInfo("/v/a.md"),
      mkInfo("/v/b.md"),
      mkInfo("/v/c.md"),
      mkInfo("/v/island.md"),
    ]);
    const byPath = new Map(findOrphans(idx).map((o) => [o.path, o.outgoing]));
    expect(byPath.get("/v/home.md")).toBe(3);
    expect(byPath.get("/v/island.md")).toBe(0);
  });

  it("자기 자신을 가리켜도 고아다", () => {
    const idx = buildIndex([mkInfo("/v/self.md", { targets: ["self"] })]);
    expect(findOrphans(idx).map((o) => o.path)).toEqual(["/v/self.md"]);
  });

  it("경로 오름차순 — 입력 순서와 무관하다", () => {
    const notes = [mkInfo("/v/z.md"), mkInfo("/v/a.md"), mkInfo("/v/m.md")];
    const forward = findOrphans(buildIndex(notes)).map((o) => o.path);
    const reversed = findOrphans(buildIndex([...notes].reverse())).map((o) => o.path);
    expect(forward).toEqual(["/v/a.md", "/v/m.md", "/v/z.md"]);
    expect(reversed).toEqual(forward);
  });

  it("표시 이름은 title 우선, 없으면 파일 이름", () => {
    const idx = buildIndex([mkInfo("/v/a.md", { title: "제목" }), mkInfo("/v/b.md")]);
    expect(findOrphans(idx).map((o) => o.name)).toEqual(["제목", "b"]);
  });
});

/**
 * 태그 위생 — **판단하지 않고 후보만 낸다.** 실행은 `tag rename`이 맡는다.
 *
 * 넣은 판정 셋의 근거는 실측이다. 뺀 것(편집거리·단수복수·계층 없는 태그)의 근거는
 * 계획 문서에 있다 — 요약하면 오탐이 많거나 언어에 의존한다.
 */
describe("태그 위생", () => {
  const kinds = (infos: LinkInfo[]) => findTagIssues(infos).map((i) => i.kind);

  /** 같은 개념을 두 분류축에 걸어둔 것. 실측에서 두 쌍 나왔다. */
  it("같은 잎을 다른 부모에 단 것을 찾는다", () => {
    const issues = findTagIssues([
      mkInfo("/v/a.md", { tags: ["class/silent-failure"] }),
      mkInfo("/v/b.md", { tags: ["issue/silent-failure"] }),
      mkInfo("/v/c.md", { tags: ["tech/rust"] }),
    ]);
    const leaf = issues.filter((i) => i.kind === "same-leaf");
    expect(leaf).toHaveLength(1);
    expect(leaf[0].tags.map((t) => t.tag)).toEqual(["class/silent-failure", "issue/silent-failure"]);
  });

  /** `norm()`은 NFC만 한다 — 소문자로 접지 않으므로 대소문자 중복이 실재할 수 있다. */
  it("대소문자만 다른 것을 찾는다", () => {
    const issues = findTagIssues([
      mkInfo("/v/a.md", { tags: ["subject/CLI"] }),
      mkInfo("/v/b.md", { tags: ["subject/cli"] }),
    ]);
    const c = issues.filter((i) => i.kind === "case-only");
    expect(c).toHaveLength(1);
    expect(c[0].tags.map((t) => t.tag).sort()).toEqual(["subject/CLI", "subject/cli"]);
  });

  it("건수를 함께 낸다", () => {
    const issues = findTagIssues([
      mkInfo("/v/a.md", { tags: ["x/dup"] }),
      mkInfo("/v/b.md", { tags: ["x/dup"] }),
      mkInfo("/v/c.md", { tags: ["y/dup"] }),
    ]);
    const leaf = issues.find((i) => i.kind === "same-leaf");
    expect(leaf?.tags).toEqual([
      { tag: "x/dup", count: 2 },
      { tag: "y/dup", count: 1 },
    ]);
  });

  /** 중복이 아니라 다른 신호 — 거의 모든 노트에 붙은 태그는 필터로 쓸모가 없다. */
  it("거의 모든 노트에 붙은 태그를 알린다", () => {
    const infos = Array.from({ length: 10 }, (_, i) => mkInfo(`/v/${i}.md`, { tags: ["all"] }));
    infos[0].tags = [];
    const u = findTagIssues(infos).filter((i) => i.kind === "near-universal");
    expect(u).toHaveLength(1);
    expect(u[0].tags[0]).toEqual({ tag: "all", count: 9 });
  });

  it("표본이 작으면 near-universal을 내지 않는다", () => {
    // 노트 셋 중 셋에 붙었다고 "무용한 태그"라고 하면 새 vault가 전부 걸린다.
    const infos = [
      mkInfo("/v/a.md", { tags: ["t"] }),
      mkInfo("/v/b.md", { tags: ["t"] }),
      mkInfo("/v/c.md", { tags: ["t"] }),
    ];
    expect(kinds(infos)).not.toContain("near-universal");
  });

  it("깨끗한 vault는 빈 목록", () => {
    expect(
      findTagIssues([
        mkInfo("/v/a.md", { tags: ["tech/rust"] }),
        mkInfo("/v/b.md", { tags: ["subject/cli"] }),
      ]),
    ).toEqual([]);
  });

  it("계층 없는 태그끼리는 잎이 같아도 자기 자신뿐이라 안 잡는다", () => {
    expect(kinds([mkInfo("/v/a.md", { tags: ["solo"] })])).toEqual([]);
  });

  it("결과가 입력 순서와 무관하다", () => {
    const infos = [
      mkInfo("/v/a.md", { tags: ["z/dup"] }),
      mkInfo("/v/b.md", { tags: ["a/dup"] }),
    ];
    const fwd = findTagIssues(infos)[0].tags.map((t) => t.tag);
    const rev = findTagIssues([...infos].reverse())[0].tags.map((t) => t.tag);
    expect(fwd).toEqual(["a/dup", "z/dup"]);
    expect(rev).toEqual(fwd);
  });
});

/**
 * 모호한 이름 — 같은 이름의 노트가 둘 이상.
 *
 * #220이 해소 규칙을 고쳤지만 **충돌 자체는 남는다.** 문서 안의 링크는 가까운 것으로
 * 가지만, 사람이 `lapis open`에 그 이름을 주면 거부된다. 어느 이름이 그런지 알아야 한다.
 */
describe("모호한 이름", () => {
  it("후보가 둘 이상인 이름을 낸다", () => {
    const idx = buildIndex([
      mkInfo("/v/k/lapis/STATE.md"),
      mkInfo("/v/k/slate/STATE.md"),
      mkInfo("/v/k/lapis/only.md"),
    ]);
    const found = findAmbiguousNames(idx);
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("state");
    expect(found[0].paths).toEqual(["/v/k/lapis/STATE.md", "/v/k/slate/STATE.md"]);
  });

  it("겹치지 않으면 빈 목록", () => {
    expect(findAmbiguousNames(buildIndex([mkInfo("/v/a.md"), mkInfo("/v/b.md")]))).toEqual([]);
  });

  it("경로 오름차순으로 정렬한다", () => {
    const idx = buildIndex([mkInfo("/v/z/dup.md"), mkInfo("/v/a/dup.md")]);
    expect(findAmbiguousNames(idx)[0].paths).toEqual(["/v/a/dup.md", "/v/z/dup.md"]);
  });
});
