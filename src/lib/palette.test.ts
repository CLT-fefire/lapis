/**
 * 팔레트 모드 분기 — `parseInput`과 `isGroupVisible`.
 *
 * ⚠️ 이 규칙에 **테스트가 없었다.** 모드별 그룹 가시성이 `CommandPalette.svelte` 안의
 * `$derived` 다섯 개에 흩어져 있었고, vitest가 `environment: "node"`에 svelte 플러그인이
 * 없어 컴포넌트를 못 띄우므로 손댈 방법이 없었다. `palette.ts`로 뽑아내면서 붙인다.
 *
 * 배경(2026-08-19): `title-short` R@1이 **37.5%**로 다른 종류(90%대)와 격차가 크다.
 * 토크나이저 교체(+1pt)와 결합 4단계화(#175, 변화 없음)로 **검색 엔진 쪽 답이 없다는 걸
 * 두 번 확인**했다. 2어절은 정보가 부족한 게 원인이라, 답은 랭킹이 아니라 **구조 팔로
 * 유도**다. 그런데 `⌘⇧F`(fulltext)에는 그 대안이 **화면에 아예 없었다** — `all` 모드에만
 * 있었다. 여기서 그 구멍을 막는다.
 */

import { describe, expect, it } from "vitest";
import { parseInput, isGroupVisible, GROUP_ORDER, type GroupName } from "./palette";
import type { PaletteMode } from "./palette";

describe("parseInput — prefix와 호환 모드", () => {
  it("prefix가 모드를 정한다", () => {
    expect(parseInput(">열기").mode).toBe("command");
    expect(parseInput("#tech/svelte5").mode).toBe("tag");
    expect(parseInput(":solution").mode).toBe("facet");
    expect(parseInput("그냥 질의").mode).toBe("all");
  });

  it("prefix를 떼고 query만 남긴다", () => {
    expect(parseInput("#tech/svelte5").query).toBe("tech/svelte5");
    expect(parseInput(">  열기  ").query).toBe("열기");
  });

  // ⌘P·⌘⇧F로 연 팔레트는 그 모드를 유지한다 — `#`를 쳐도 태그 모드로 새지 않는다.
  it("files·fulltext 힌트는 prefix를 무시한다", () => {
    expect(parseInput("#tag", "files")).toEqual({ mode: "files", query: "#tag" });
    expect(parseInput(">cmd", "fulltext")).toEqual({ mode: "fulltext", query: ">cmd" });
  });
});

describe("isGroupVisible — 모드별 그룹", () => {
  /** 모드 → 보이는 그룹 전체. 규칙을 표로 박아 회귀를 잡는다. */
  const visible = (mode: PaletteMode): GroupName[] =>
    GROUP_ORDER.filter((g) => isGroupVisible(mode, g));

  it("all(⌘K)은 전부 낸다", () => {
    expect(visible("all")).toEqual([...GROUP_ORDER]);
  });

  it("files(⌘P)는 본문을 뺀다 — 파일 이름 검색이다", () => {
    expect(visible("files")).not.toContain("content");
    expect(visible("files")).toContain("notes");
  });

  // 이 PR의 핵심. 종전엔 fulltext가 content 하나뿐이었다.
  it("fulltext(⌘⇧F)는 본문 + 구조 팔을 낸다", () => {
    const v = visible("fulltext");
    expect(v).toContain("content");
    expect(v).toContain("tags");
    expect(v).toContain("facets");
  });

  it("fulltext는 노트 이름 매칭을 안 낸다 — 그건 ⌘P의 몫이다", () => {
    expect(visible("fulltext")).not.toContain("notes");
  });

  it("prefix 단일 목적 모드는 자기 그룹만 낸다", () => {
    expect(visible("tag")).toEqual(["recents", "notes", "content", "tags"]);
    expect(visible("facet")).toEqual(["recents", "notes", "content", "facets"]);
    expect(visible("command")).toEqual(["recents", "notes", "content", "commands"]);
  });

  it("recents는 모든 모드에서 낸다 — 빈 입력 흐름이라 모드와 무관하다", () => {
    for (const mode of ["all", "files", "fulltext", "tag", "facet", "command"] as PaletteMode[]) {
      expect(isGroupVisible(mode, "recents")).toBe(true);
    }
  });

  // ⚠️ 순서 자체가 계약이다 — `displayList`가 이 순서로 평면화하고 ↑/↓ 탐색이 그 인덱스를 쓴다.
  it("GROUP_ORDER가 화면 순서다", () => {
    expect(GROUP_ORDER).toEqual(["recents", "notes", "content", "tags", "facets", "commands"]);
  });
});
