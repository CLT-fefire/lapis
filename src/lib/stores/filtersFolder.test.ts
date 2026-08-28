import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyFilters, buildFacetCounts, emptySelection } from "./filters";
import type { LinkInfo } from "$lib/tauri/notes";

/**
 * 필터의 **폴더 축**.
 *
 * 2026-08-28 실측: 이 vault 는 한 안에 프로젝트가 둘이고(`knowledge/lapis` ·
 * `knowledge/slate`), `audit: tags` 가 낸 이름 충돌 **7건이 전부** 그 둘 사이였다.
 * doc_kind·topic 으로는 그 경계를 못 긋는다 — 두 프로젝트가 **같은 doc_kind 를 쓴다.**
 */

function note(path: string, doc_kind: string, topic: string): LinkInfo {
  return {
    source_path: path,
    source_name: path.split("/").pop()!.replace(/\.md$/, ""),
    title: null,
    doc_kind,
    topic,
    tags: [],
    targets: [],
    related: [],
    props: {},
  } as unknown as LinkInfo;
}

const INFOS = [
  note("knowledge/lapis/plans/a.md", "plan", "search"),
  note("knowledge/lapis/reference/b.md", "reference", "ui"),
  note("knowledge/slate/plans/c.md", "plan", "search"),
  note("knowledge/slate/reference/d.md", "reference", "cards"),
];

const paths = (out: LinkInfo[]) => out.map((i) => i.source_path).sort();

/** 축 셋만 쓰는 짧은 형태 — 이 파일의 관심사는 폴더다. */
function sel(opts: { docKinds?: string[]; topics?: string[]; folders?: string[] }) {
  const s = emptySelection();
  for (const v of opts.docKinds ?? []) s.docKinds.add(v);
  for (const v of opts.topics ?? []) s.topics.add(v);
  for (const v of opts.folders ?? []) s.folders.add(v);
  return s;
}

describe("폴더 축", () => {
  it("아무것도 안 고르면 빈 결과", () => {
    expect(applyFilters(INFOS, sel({}))).toEqual([]);
  });

  /** 폴더만 골라도 결과가 나와야 한다 — 안 그러면 축이 하나 죽은 것이다. */
  it("폴더만 골라도 걸러진다", () => {
    expect(paths(applyFilters(INFOS, sel({ folders: ["knowledge/lapis/"] })))).toEqual([
      "knowledge/lapis/plans/a.md",
      "knowledge/lapis/reference/b.md",
    ]);
  });

  /**
   * ⚠️ 이게 이 축을 만든 이유다. 두 프로젝트가 **같은 `doc_kind`** 를 쓰므로
   * `plan` 만으로는 경계를 못 긋는다.
   */
  it("다른 축과는 AND — 같은 doc_kind 가 두 프로젝트에 있어도 갈린다", () => {
    expect(applyFilters(INFOS, sel({ docKinds: ["plan"] }))).toHaveLength(2);
    expect(
      paths(applyFilters(INFOS, sel({ docKinds: ["plan"], folders: ["knowledge/slate/"] }))),
    ).toEqual(["knowledge/slate/plans/c.md"]);
  });

  it("같은 축 안에서는 OR", () => {
    const out = applyFilters(
      INFOS,
      sel({ folders: ["knowledge/lapis/plans/", "knowledge/slate/plans/"] }),
    );
    expect(paths(out)).toEqual(["knowledge/lapis/plans/a.md", "knowledge/slate/plans/c.md"]);
  });

  /** ⚠️ 문자열 접두사다 — MCP `under`·`exclude` 와 같은 규칙. */
  it("세그먼트 중간에서 끊는 접두사도 먹는다", () => {
    expect(applyFilters(INFOS, sel({ folders: ["knowledge/la"] }))).toHaveLength(2);
  });

  it("맞는 게 없으면 빈 결과", () => {
    expect(applyFilters(INFOS, sel({ folders: ["없는/"] }))).toEqual([]);
  });
});

describe("facet 개수는 폴더 축을 안 센다", () => {
  /**
   * ⚠️ `buildFacetCounts` 는 doc_kind·topic 만 센다. 폴더 후보는 경로에서 나오므로
   * `folderScope.ts` 의 `scopeOptions` 가 따로 낸다.
   */
  it("옛 동작 그대로", () => {
    const { docKindCounts, topicCounts } = buildFacetCounts(INFOS);
    expect(docKindCounts.get("plan")).toBe(2);
    expect(topicCounts.get("search")).toBe(2);
  });
});

/**
 * ⚠️ **배선 가드.** 위 단언이 전부 초록이어도 `FilterPanel.svelte` 가 축을 안 그리면
 * 화면은 그대로다 — 에러 없이. 이 세션에서 실제로 여러 번 겪은 실패다.
 */
describe("필터 패널 배선", () => {
  const src = (() => {
    const raw = readFileSync(
      fileURLToPath(new URL("../FilterPanel.svelte", import.meta.url)),
      "utf-8",
    );
    return raw
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  })();

  it("폴더 후보를 경로에서 뽑는다", () => {
    expect(src).toMatch(/scopeOptions\(/);
  });

  it("폴더 칩을 그린다", () => {
    expect(src).toMatch(/#each folderOptions as opt/);
    expect(src).toMatch(/toggleFolder\(/);
  });

  /** 🔴 3차에서 빠뜨렸던 축 — 그리는지 본다. */
  it("임의 frontmatter 축을 그린다", () => {
    expect(src).toMatch(/propAxes\(/);
    expect(src).toMatch(/togglePropValue\(/);
  });

  /** ⚠️ 안 넘기면 고른 값이 목록에 반영되지 않는다 — 칩만 켜지고 결과는 그대로다. */
  it("applyFilters 에 선택 객체를 넘긴다", () => {
    const call = src.match(/applyFilters\(([\s\S]*?)\);/);
    expect(call, "applyFilters 호출을 못 찾았다").not.toBeNull();
    expect(call![1]).toContain("selection");
  });
});
