import { describe, it, expect } from "vitest";
import {
  availableColumns,
  cellValue,
  compareCells,
  filterRows,
  parseSavedViews,
  relativeDir,
  sortRows,
  type SavedView,
} from "$lib/tableView";
import type { LinkInfo } from "$lib/tauri/notes";

const ROOT = "/v";

function note(path: string, over: Partial<LinkInfo> = {}): LinkInfo {
  return {
    source_path: `${ROOT}/${path}`,
    source_name: path.split("/").pop()!.replace(/\.md$/, ""),
    title: null,
    aliases: [],
    targets: [],
    tags: [],
    doc_kind: null,
    topic: null,
    related: [],
    props: {},
    ...over,
  };
}

describe("cellValue", () => {
  it("제목은 frontmatter title 우선, 없으면 파일명", () => {
    expect(cellValue(note("a.md", { title: "제목" }), "title", ROOT)).toBe("제목");
    expect(cellValue(note("a.md"), "title", ROOT)).toBe("a");
    // 공백만 있는 title은 없는 것으로 — vault에 실제로 있다.
    expect(cellValue(note("a.md", { title: "   " }), "title", ROOT)).toBe("a");
  });

  it("경로 컬럼은 디렉터리만 — 파일명은 제목 컬럼이 이미 낸다", () => {
    expect(cellValue(note("plans/x.md"), "path", ROOT)).toBe("plans");
    expect(cellValue(note("x.md"), "path", ROOT)).toBe("");
  });

  it("props 키는 값들을 이어 붙인다", () => {
    const n = note("a.md", { props: { related: ["x", "y"] } });
    expect(cellValue(n, "related", ROOT)).toBe("x, y");
  });

  it("없는 키는 빈 문자열 — 정렬에서 뒤로 밀리는 신호", () => {
    expect(cellValue(note("a.md"), "nope", ROOT)).toBe("");
  });

  it("relativeDir는 root에 슬래시가 있든 없든 같다", () => {
    expect(relativeDir("/v/plans/x.md", "/v")).toBe("plans");
    expect(relativeDir("/v/plans/x.md", "/v/")).toBe("plans");
  });
});

describe("availableColumns", () => {
  it("빈도순으로 낸다", () => {
    const infos = [
      note("a.md", { props: { project: ["l"], created: ["2026-01-01"] } }),
      note("b.md", { props: { project: ["l"] } }),
    ];
    expect(availableColumns(infos)).toEqual([
      { key: "project", count: 2 },
      { key: "created", count: 1 },
    ]);
  });

  it("붙박이가 덮는 키는 후보에서 뺀다 — 같은 값 컬럼이 두 번 뜨지 않게", () => {
    const infos = [note("a.md", { props: { doc_kind: ["plan"], topic: ["x"], tags: ["t"] } })];
    expect(availableColumns(infos)).toEqual([]);
  });

  it("값이 공백뿐인 키는 세지 않는다", () => {
    expect(availableColumns([note("a.md", { props: { status: ["  "] } })])).toEqual([]);
  });
});

describe("filterRows", () => {
  const infos = [
    note("a.md", { doc_kind: "plan", topic: "search" }),
    note("b.md", { doc_kind: "solution", topic: "search", title: "Beta 계획" }),
    note("sub/c.md", { doc_kind: "plan", topic: "vault" }),
  ];
  const empty = { docKinds: new Set<string>(), topics: new Set<string>(), text: "" };

  it("⭐ 아무것도 안 고르면 전량 — FilterPanel과 기본값이 다르다", () => {
    // `stores/filters.ts`의 applyFilters는 여기서 []를 낸다. 사이드바에선 그게 맞지만
    // 테이블은 훑어보는 자리라 전량이 맞다. 이 차이가 의도적이라는 것을 고정한다.
    expect(filterRows(infos, empty, ROOT)).toHaveLength(3);
  });

  it("같은 facet 안에서는 OR", () => {
    const f = { ...empty, docKinds: new Set(["plan", "solution"]) };
    expect(filterRows(infos, f, ROOT)).toHaveLength(3);
  });

  it("다른 facet 사이에서는 AND", () => {
    const f = { ...empty, docKinds: new Set(["plan"]), topics: new Set(["search"]) };
    expect(filterRows(infos, f, ROOT).map((i) => i.source_name)).toEqual(["a"]);
  });

  it("텍스트는 경로에도 걸린다", () => {
    // ⚠️ 경로까지 본다는 건 디렉터리 이름이 걸린다는 뜻이다 — `sub/c.md`는 `b`로도 걸린다.
    // 처음 이 테스트를 `text: "B"` → `["b"]`로 썼다가 `["b","c"]`가 나와서 알았다.
    expect(filterRows(infos, { ...empty, text: "sub/" }, ROOT).map((i) => i.source_name)).toEqual(["c"]);
  });

  it("텍스트는 제목에 걸리고 대소문자를 가리지 않는다", () => {
    expect(filterRows(infos, { ...empty, text: "BETA" }, ROOT).map((i) => i.source_name)).toEqual(["b"]);
  });
});

describe("compareCells", () => {
  it("ISO 날짜는 날짜로", () => {
    expect(compareCells("2026-01-02", "2026-01-10")).toBeLessThan(0);
  });

  it("숫자는 숫자로 — 문자열이면 '10' < '9'가 된다", () => {
    expect(compareCells("9", "10")).toBeLessThan(0);
  });

  it("한쪽만 숫자면 문자열 비교로 떨어진다", () => {
    expect(compareCells("9", "v9")).toBeLessThan(0);
  });
});

describe("sortRows", () => {
  const infos = [
    note("a.md", { props: { created: ["2026-03-01"] } }),
    note("b.md", { props: { created: ["2026-01-01"] } }),
    note("c.md", {}), // 값 없음
  ];

  it("오름차순", () => {
    const r = sortRows(infos, { key: "created", dir: "asc" }, ROOT);
    expect(r.map((i) => i.source_name)).toEqual(["b", "a", "c"]);
  });

  it("⭐ 빈 값은 방향을 뒤집어도 뒤에 남는다", () => {
    // 안 그러면 내림차순마다 빈칸 화면이 먼저 나온다 — 이 vault는 대부분의 컬럼이
    // 값 있는 노트가 소수라 그 증상이 기본값이 된다.
    const r = sortRows(infos, { key: "created", dir: "desc" }, ROOT);
    expect(r.map((i) => i.source_name)).toEqual(["a", "b", "c"]);
  });

  it("동점은 경로로 안정화 — 렌더마다 자리가 바뀌지 않게", () => {
    const same = [
      note("z.md", { props: { s: ["x"] } }),
      note("a.md", { props: { s: ["x"] } }),
    ];
    const r = sortRows(same, { key: "s", dir: "desc" }, ROOT);
    expect(r.map((i) => i.source_name)).toEqual(["a", "z"]);
  });

  it("sort가 null이면 입력 순서를 유지하고 원본을 건드리지 않는다", () => {
    const src = [...infos];
    expect(sortRows(src, null, ROOT)).toEqual(src);
    expect(src.map((i) => i.source_name)).toEqual(["a", "b", "c"]);
  });
});

describe("parseSavedViews", () => {
  const good: SavedView = {
    id: "1",
    name: "계획",
    columns: ["title", "created"],
    sort: { key: "created", dir: "desc" },
    docKinds: ["plan"],
    topics: [],
  };

  it("정상 항목은 그대로", () => {
    expect(parseSavedViews(JSON.stringify([good]))).toEqual([good]);
  });

  it("null·빈 문자열·깨진 JSON은 빈 목록", () => {
    expect(parseSavedViews(null)).toEqual([]);
    expect(parseSavedViews("")).toEqual([]);
    expect(parseSavedViews("{{{")).toEqual([]);
    expect(parseSavedViews('{"not":"array"}')).toEqual([]);
  });

  it("⭐ 깨진 항목만 버리고 나머지는 살린다", () => {
    // 저장뷰 하나가 깨졌다고 나머지를 잃으면 사용자는 이유를 알 수 없다.
    const raw = JSON.stringify([good, { id: 5 }, { name: "이름만" }]);
    expect(parseSavedViews(raw)).toEqual([good]);
  });

  it("sort가 이상하면 null로 떨어뜨리되 뷰는 살린다", () => {
    const raw = JSON.stringify([{ ...good, sort: { key: "x", dir: "sideways" } }]);
    expect(parseSavedViews(raw)[0].sort).toBeNull();
    expect(parseSavedViews(raw)[0].name).toBe("계획");
  });

  it("facet 배열에 섞인 비문자열은 걸러낸다", () => {
    const raw = JSON.stringify([{ ...good, docKinds: ["plan", 3, null], topics: "nope" }]);
    expect(parseSavedViews(raw)[0].docKinds).toEqual(["plan"]);
    expect(parseSavedViews(raw)[0].topics).toEqual([]);
  });
});
