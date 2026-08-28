import { describe, it, expect } from "vitest";
import { applyFilters, propAxes, emptySelection, selectionSize } from "./filters";
import type { LinkInfo } from "$lib/tauri/notes";

/**
 * **임의 frontmatter 축으로 거르기.**
 *
 * ## 🔴 3차 분석에서 계획해 놓고 빠뜨린 것
 *
 * 3차 계획서가 `PR-C` 로 적어 뒀는데 폴더 축만 넣은 채 끝났다. 측정은 그대로다 —
 * `status` 가 **44노트(41%)** 에 있고, 한눈에 보기에는 **컬럼으로 추가되는데
 * 거를 수는 없었다.** 보이는데 못 거르는 것은 기능이 반쪽인 상태다.
 *
 * ## ⚠️ 아무 필드나 축이 되면 안 된다
 *
 * `date` 는 96% 노트에 있지만 값이 전부 다르다 — 칩이 107개 뜨고 하나를 고르면 노트 한 개가
 * 남는다. 그건 필터가 아니라 파일 열기다. 감사(`vaultAudit`)가 "이건 열거형인가"를 이미
 * 같은 문턱으로 묻고 있으므로 **같은 규칙**을 쓴다.
 */

function note(path: string, props: Record<string, string[]>, doc_kind = "note"): LinkInfo {
  return {
    source_path: path,
    source_name: path.split("/").pop()!,
    title: null,
    doc_kind,
    topic: null,
    tags: [],
    targets: [],
    related: [],
    props,
  } as unknown as LinkInfo;
}

/** `status` 실측 분포에 가깝게. */
const INFOS: LinkInfo[] = [
  ...Array.from({ length: 6 }, (_, i) => note(`/v/a${i}.md`, { status: ["진행 중"] })),
  ...Array.from({ length: 5 }, (_, i) => note(`/v/b${i}.md`, { status: ["완료"] })),
  note("/v/c.md", { status: ["미착수"] }),
  note("/v/d.md", {}),
];

const paths = (out: LinkInfo[]) => out.map((i) => i.source_path).sort();

describe("propAxes — 무엇이 축이 될 수 있나", () => {
  it("값이 굳은 필드를 축으로 낸다", () => {
    const axes = propAxes(INFOS);
    const status = axes.find((a) => a.field === "status");
    expect(status, "status 가 축이어야 한다").toBeDefined();
    expect(status!.values.map((v) => v.value).sort()).toEqual(["미착수", "완료", "진행 중"]);
    expect(status!.values.find((v) => v.value === "진행 중")!.count).toBe(6);
  });

  it("값이 많은 순으로 낸다", () => {
    const status = propAxes(INFOS).find((a) => a.field === "status")!;
    expect(status.values[0].value).toBe("진행 중");
  });

  /**
   * ⚠️ **값이 전부 다른 필드는 축이 아니다.** `date` 가 그렇다 — 칩이 노트 수만큼 뜨고
   * 하나를 고르면 노트 한 개가 남는다. 필터가 아니라 파일 열기다.
   */
  it("값이 거의 다 다른 필드는 뺀다", () => {
    const dated = Array.from({ length: 12 }, (_, i) =>
      note(`/v/x${i}.md`, { date: [`2026-08-${String(i + 1).padStart(2, "0")}`] }),
    );
    expect(propAxes(dated).map((a) => a.field)).not.toContain("date");
  });

  /** ⚠️ 타입 있는 필드는 **이미 자기 축**이 있다 — 두 번 나오면 어느 쪽을 고를지 헷갈린다. */
  it("doc_kind · topic · tags · title 은 안 낸다", () => {
    const infos = [note("/v/a.md", { doc_kind: ["plan"], topic: ["x"], tags: ["t"], title: ["T"] })];
    const fields = propAxes(infos).map((a) => a.field);
    for (const f of ["doc_kind", "topic", "tags", "title"]) expect(fields).not.toContain(f);
  });

  /** ⚠️ 관계 필드는 값이 **노트 이름**이라 거르는 축이 아니다. */
  it("related · aliases 는 안 낸다", () => {
    const infos = Array.from({ length: 8 }, (_, i) =>
      note(`/v/a${i}.md`, { related: ["같은값"], aliases: ["별칭"] }),
    );
    const fields = propAxes(infos).map((a) => a.field);
    expect(fields).not.toContain("related");
    expect(fields).not.toContain("aliases");
  });

  /** 표본이 적으면 굳었는지 판단할 근거가 없다 — 감사와 같은 문턱. */
  it("쓰인 노트가 너무 적으면 안 낸다", () => {
    expect(propAxes([note("/v/a.md", { rare: ["x"] })]).map((a) => a.field)).not.toContain("rare");
  });
});

describe("applyFilters — 임의 축", () => {
  it("아무것도 안 고르면 빈 결과", () => {
    expect(applyFilters(INFOS, emptySelection())).toEqual([]);
  });

  it("임의 축만 골라도 걸러진다", () => {
    const sel = emptySelection();
    sel.props.set("status", new Set(["완료"]));
    expect(applyFilters(INFOS, sel)).toHaveLength(5);
  });

  it("같은 축 안에서는 OR", () => {
    const sel = emptySelection();
    sel.props.set("status", new Set(["완료", "미착수"]));
    expect(applyFilters(INFOS, sel)).toHaveLength(6);
  });

  /** ⚠️ 값이 없는 노트는 그 축을 고르면 빠진다 — `status` 없는 노트가 "완료"일 리 없다. */
  it("그 필드가 없는 노트는 빠진다", () => {
    const sel = emptySelection();
    sel.props.set("status", new Set(["완료"]));
    expect(paths(applyFilters(INFOS, sel))).not.toContain("/v/d.md");
  });

  it("다른 축과는 AND", () => {
    const mixed = [
      note("/v/p.md", { status: ["완료"] }, "plan"),
      note("/v/q.md", { status: ["완료"] }, "adr"),
    ];
    const sel = emptySelection();
    sel.props.set("status", new Set(["완료"]));
    sel.docKinds.add("plan");
    expect(paths(applyFilters(mixed, sel))).toEqual(["/v/p.md"]);
  });

  /** 축이 둘이면 둘 다 맞아야 한다. */
  it("임의 축 둘 사이도 AND", () => {
    const infos = [
      note("/v/a.md", { status: ["완료"], area: ["ui"] }),
      note("/v/b.md", { status: ["완료"], area: ["core"] }),
    ];
    const sel = emptySelection();
    sel.props.set("status", new Set(["완료"]));
    sel.props.set("area", new Set(["ui"]));
    expect(paths(applyFilters(infos, sel))).toEqual(["/v/a.md"]);
  });

  /** ⚠️ 한 노트가 같은 필드에 값을 여럿 가질 수 있다(YAML 배열) — 하나만 맞아도 통과. */
  it("값이 여럿인 노트는 하나만 맞아도 통과", () => {
    const infos = [note("/v/a.md", { area: ["ui", "core"] })];
    const sel = emptySelection();
    sel.props.set("area", new Set(["core"]));
    expect(applyFilters(infos, sel)).toHaveLength(1);
  });

  /** ⚠️ 빈 Set 을 남긴 축은 **없는 것과 같다.** 안 그러면 값을 다 해제한 순간 결과가 빈다. */
  it("빈 Set 인 축은 안 거른다", () => {
    const sel = emptySelection();
    sel.props.set("status", new Set());
    expect(applyFilters(INFOS, sel)).toEqual([]);
    sel.docKinds.add("note");
    expect(applyFilters(INFOS, sel).length).toBeGreaterThan(0);
  });
});

describe("selectionSize", () => {
  it("모든 축의 고른 값 수를 더한다", () => {
    const sel = emptySelection();
    expect(selectionSize(sel)).toBe(0);
    sel.docKinds.add("plan");
    sel.folders.add("a/");
    sel.props.set("status", new Set(["완료", "진행 중"]));
    expect(selectionSize(sel)).toBe(4);
  });

  /** ⚠️ 빈 Set 인 축은 안 센다 — 화면의 "필터 지우기"가 켜져 있는데 아무것도 안 걸린다. */
  it("빈 축은 안 센다", () => {
    const sel = emptySelection();
    sel.props.set("status", new Set());
    expect(selectionSize(sel)).toBe(0);
  });
});
