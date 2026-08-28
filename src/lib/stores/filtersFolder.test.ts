import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyFilters, buildFacetCounts } from "./filters";
import type { LinkInfo } from "$lib/tauri/notes";

/**
 * 필터의 **세 번째 축 — 폴더**.
 *
 * 2026-08-28 실측: 이 vault 는 한 안에 프로젝트가 둘이고(`knowledge/lapis` ·
 * `knowledge/slate`), `audit: tags` 가 낸 이름 충돌 **7건이 전부** 그 둘 사이였다.
 * doc_kind·topic 으로는 그 경계를 못 긋는다 — 두 프로젝트가 **같은 doc_kind 를 쓴다.**
 *
 * ⚠️ 여기서 조용히 틀리는 방법은 축을 더하면서 **빈 선택의 뜻**을 흐리는 것이다.
 * "아무것도 안 골랐으면 아무것도 안 보여준다"가 원래 규칙인데, 축이 셋이 되면
 * "폴더만 골랐을 때"가 새로 생긴다.
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

describe("폴더 축", () => {
  it("아무것도 안 고르면 빈 결과 — 옛 규칙 그대로", () => {
    expect(applyFilters(INFOS, new Set(), new Set(), new Set())).toEqual([]);
  });

  /** 폴더만 골라도 결과가 나와야 한다 — 안 그러면 축이 하나 죽은 것이다. */
  it("폴더만 골라도 걸러진다", () => {
    const out = applyFilters(INFOS, new Set(), new Set(), new Set(["knowledge/lapis/"]));
    expect(paths(out)).toEqual([
      "knowledge/lapis/plans/a.md",
      "knowledge/lapis/reference/b.md",
    ]);
  });

  /**
   * ⚠️ 이게 이 축을 만든 이유다. 두 프로젝트가 **같은 `doc_kind`** 를 쓰므로
   * `plan` 만으로는 경계를 못 긋는다.
   */
  it("다른 축과는 AND — 같은 doc_kind 가 두 프로젝트에 있어도 갈린다", () => {
    const both = applyFilters(INFOS, new Set(["plan"]), new Set(), new Set());
    expect(paths(both)).toHaveLength(2);

    const one = applyFilters(INFOS, new Set(["plan"]), new Set(), new Set(["knowledge/slate/"]));
    expect(paths(one)).toEqual(["knowledge/slate/plans/c.md"]);
  });

  it("같은 축 안에서는 OR", () => {
    const out = applyFilters(
      INFOS,
      new Set(),
      new Set(),
      new Set(["knowledge/lapis/plans/", "knowledge/slate/plans/"]),
    );
    expect(paths(out)).toEqual([
      "knowledge/lapis/plans/a.md",
      "knowledge/slate/plans/c.md",
    ]);
  });

  /** ⚠️ 문자열 접두사다 — MCP `under`·`exclude` 와 같은 규칙. */
  it("세그먼트 중간에서 끊는 접두사도 먹는다", () => {
    const out = applyFilters(INFOS, new Set(), new Set(), new Set(["knowledge/la"]));
    expect(paths(out)).toHaveLength(2);
  });

  it("맞는 게 없으면 빈 결과", () => {
    expect(applyFilters(INFOS, new Set(), new Set(), new Set(["없는/"]))).toEqual([]);
  });
});

describe("facet 개수는 폴더 축을 안 센다", () => {
  /**
   * ⚠️ `buildFacetCounts` 는 doc_kind·topic 만 센다. 폴더 후보는 경로에서 나오므로
   * `folderScope.ts` 의 `scopeOptions` 가 따로 낸다 — 세는 코드를 하나로 합치면
   * 한쪽이 `LinkInfo` 를, 다른 쪽이 경로 문자열을 원해서 인자가 지저분해진다.
   */
  it("옛 동작 그대로", () => {
    const { docKindCounts, topicCounts } = buildFacetCounts(INFOS);
    expect(docKindCounts.get("plan")).toBe(2);
    expect(topicCounts.get("search")).toBe(2);
  });
});

/**
 * ⚠️ **배선 가드.** 위 단언이 전부 초록이어도 `FilterPanel.svelte` 가 새 축을 안 그리면
 * 화면은 그대로다 — 에러 없이. 이 세션에서 실제로 여러 번 겪은 실패다.
 */
describe("필터 패널 배선", () => {
  const src = (() => {
    const raw = readFileSync(
      fileURLToPath(new URL("../FilterPanel.svelte", import.meta.url)),
      "utf-8",
    );
    // 주석을 지운다 — 안 지우면 가드가 자기 설명 문구에 맞는다.
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

  /** ⚠️ 안 넘기면 고른 폴더가 목록에 반영되지 않는다 — 칩만 켜지고 결과는 그대로다. */
  it("applyFilters 에 폴더 축을 넘긴다", () => {
    const call = src.match(/applyFilters\(([\s\S]*?)\);/);
    expect(call, "applyFilters 호출을 못 찾았다").not.toBeNull();
    expect(call![1]).toContain("selectedFolders");
  });

  /** 선택 여부 판정에도 들어가야 한다 — 아니면 폴더만 골랐을 때 목록이 안 뜬다. */
  it("선택 여부에 폴더를 센다", () => {
    const has = src.match(/hasAnySelection = \$derived\(([\s\S]*?)\);/);
    expect(has, "hasAnySelection 을 못 찾았다").not.toBeNull();
    expect(has![1]).toContain("selectedFolders");
  });
});
