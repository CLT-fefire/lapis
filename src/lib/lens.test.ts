import { describe, it, expect } from "vitest";
import { groupingCandidates, groupNotesByField, NO_VALUE_LABEL } from "./lens";
import type { LinkInfo } from "./tauri/notes";

function mkInfo(
  source_path: string,
  props: Record<string, string[]> = {},
): LinkInfo {
  const stem = source_path.split("/").pop()!.replace(/\.md$/, "");
  return {
    source_path,
    source_name: stem,
    title: null,
    aliases: [],
    targets: [],
    tags: [],
    doc_kind: null,
    topic: null,
    related: [],
    props,
  };
}

describe("groupingCandidates", () => {
  const infos = [
    mkInfo("/v/a.md", { status: ["done"], title: ["A"], phase: ["4.3"] }),
    mkInfo("/v/b.md", { status: ["done"], title: ["B"], phase: ["4.3"] }),
    mkInfo("/v/c.md", { status: ["in-progress"], title: ["C"], phase: ["5.1"] }),
    mkInfo("/v/d.md", { status: ["done"], title: ["D"], phase: ["5.1"] }),
  ];

  it("저카디널리티 분류 필드만 후보 (status/phase)", () => {
    const cands = groupingCandidates(infos);
    const fields = cands.map((c) => c.field);
    expect(fields).toContain("status");
    expect(fields).toContain("phase");
  });

  it("title처럼 노트마다 고유한 필드는 제외 (valueCount == noteCount)", () => {
    const cands = groupingCandidates(infos);
    expect(cands.map((c) => c.field)).not.toContain("title");
  });

  it("필드명 알파벳 순 정렬 + count/valueCount 보고", () => {
    const cands = groupingCandidates(infos);
    expect(cands.map((c) => c.field)).toEqual(["phase", "status"]);
    const status = cands.find((c) => c.field === "status")!;
    expect(status.noteCount).toBe(4);
    expect(status.valueCount).toBe(2); // done, in-progress
  });

  it("blocklist 필드(related/description 등)는 저카디널리티여도 제외", () => {
    const withRel = [
      mkInfo("/v/x.md", { related: ["y"], description: ["짧은 설명"] }),
      mkInfo("/v/y.md", { related: ["x"], description: ["짧은 설명"] }),
      mkInfo("/v/z.md", { related: ["x"], description: ["짧은 설명"] }),
    ];
    const fields = groupingCandidates(withRel).map((c) => c.field);
    expect(fields).not.toContain("related");
    expect(fields).not.toContain("description");
  });

  it("noteCount < 3 필드는 제외", () => {
    const few = [
      mkInfo("/v/a.md", { rare: ["x"] }),
      mkInfo("/v/b.md", { rare: ["x"] }),
    ];
    expect(groupingCandidates(few).map((c) => c.field)).not.toContain("rare");
  });
});

describe("groupNotesByField", () => {
  const infos = [
    mkInfo("/v/a.md", { status: ["done"] }),
    mkInfo("/v/c.md", { status: ["done"] }),
    mkInfo("/v/b.md", { status: ["in-progress"] }),
    mkInfo("/v/d.md", {}), // status 없음
  ];

  it("값별 그룹 + (미지정) 버킷", () => {
    const groups = groupNotesByField(infos, "status");
    const names = groups.map((g) => g.rel_path); // rel_path = 원본 값
    expect(names).toEqual(["done", "in-progress", NO_VALUE_LABEL]);
  });

  it("그룹은 노트 수 내림차순, (미지정)은 항상 마지막", () => {
    const groups = groupNotesByField(infos, "status");
    expect(groups[0].rel_path).toBe("done"); // 2개
    expect(groups[groups.length - 1].rel_path).toBe(NO_VALUE_LABEL);
  });

  it("그룹은 합성 dir, leaf는 실제 노트 path + 이름순", () => {
    const groups = groupNotesByField(infos, "status");
    const done = groups[0];
    expect(done.is_dir).toBe(true);
    expect(done.name).toBe("done · 2");
    expect(done.children!.map((c) => c.path)).toEqual(["/v/a.md", "/v/c.md"]);
    expect(done.children!.every((c) => !c.is_dir)).toBe(true);
  });

  it("합성 그룹 path는 실제 노트 path와 충돌하지 않음", () => {
    const groups = groupNotesByField(infos, "status");
    expect(groups.every((g) => g.path.startsWith("lens://"))).toBe(true);
  });
});
