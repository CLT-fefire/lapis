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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseInput,
  isGroupVisible,
  GROUP_ORDER,
  isStrongCommandMatch,
  groupResults,
  type GroupName,
  type PaletteResult,
} from "./palette";
import { BUILTIN_COMMANDS } from "./commands";
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
    // ⚠️ `recents`·`changed`는 빈 입력 흐름 전용이라 모드와 무관하게 "보인다"로 둔다
    // (그 모드에서는 어차피 비어 있다). 가시성과 채워짐을 섞으면 규칙이 두 벌이 된다.
    expect(visible("tag")).toEqual(["recents", "changed", "notes", "content", "tags"]);
    expect(visible("facet")).toEqual(["recents", "changed", "notes", "content", "facets"]);
    // `command` 모드에서는 승격된 명령도 보인다 — 명령이 그 모드의 목적이다.
    expect(visible("command")).toEqual([
      "topCommands",
      "recents",
      "changed",
      "notes",
      "content",
      "commands",
    ]);
  });

  it("recents는 모든 모드에서 낸다 — 빈 입력 흐름이라 모드와 무관하다", () => {
    for (const mode of ["all", "files", "fulltext", "tag", "facet", "command"] as PaletteMode[]) {
      expect(isGroupVisible(mode, "recents")).toBe(true);
      expect(isGroupVisible(mode, "changed")).toBe(true);
    }
  });

  // ⚠️ 순서 자체가 계약이다 — `displayList`가 이 순서로 평면화하고 ↑/↓ 탐색이 그 인덱스를 쓴다.
  it("GROUP_ORDER가 화면 순서다", () => {
    expect(GROUP_ORDER).toEqual([
      "topCommands",
      "recents",
      "changed",
      "notes",
      "content",
      "tags",
      "facets",
      "commands",
    ]);
  });

  /**
   * ⚠️ **`GROUP_ORDER`는 선언일 뿐이고, 실제 자리는 `CommandPalette.svelte`가 정한다.**
   *
   * 둘이 갈라지면 아무 에러도 안 난다 — 배열은 멀쩡하고 화면만 다른 순서로 그린다.
   * 명령이 항상 맨 아래 있던 결함이 정확히 이 틈에서 나왔다: 점수 우대 코드는
   * `palette.ts`에 있었는데 자리를 정하는 것은 다른 파일이었다.
   *
   * 그래서 컴포넌트 소스를 문자열로 읽어 `displayList`가 밀어 넣는 순서를 뽑아 대조한다.
   */
  it("컴포넌트의 렌더 순서가 GROUP_ORDER와 같다", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./CommandPalette.svelte", import.meta.url)),
      "utf-8",
    );
    const pushes = [...src.matchAll(/out\.push\(\.\.\.groups\.(\w+)\)/g)].map((m) => m[1]);

    // ⚠️ 카나리아 — 정규식이 깨지면 빈 배열끼리 비교하며 통과한다.
    expect(pushes.length).toBe(GROUP_ORDER.length);
    expect(pushes).toEqual([...GROUP_ORDER]);
  });
});

/**
 * ⌘K에서 명령 이름을 정확히 치기 시작했는데도 명령이 **맨 아래** 있던 것.
 *
 * 점수 문제가 아니라 **순서** 문제였다. `normalizedScore`가 명령에 `× 1.2` 우대를 주고
 * 있었지만, `CommandPalette.svelte`의 그룹 렌더 순서가 고정이라(commands가 항상 마지막)
 * 점수를 덮어썼다. **한 파일만 봐서는 안 보이는 부류다** — 우대 코드는 멀쩡히 있다.
 */
describe("명령 승격 — 이름을 치기 시작하면 위로 온다", () => {
  const labels = () =>
    BUILTIN_COMMANDS.map((c) => c.label).filter((l) => typeof l === "string" && l.length > 0);

  /** ⚠️ 카나리아 — 라벨을 못 읽으면 아래 테스트가 빈 것을 보고 통과한다. */
  it("내장 명령 라벨을 실제로 읽었다", () => {
    expect(labels().length).toBeGreaterThan(5);
  });

  it("라벨의 단어 접두사면 강한 매치다", () => {
    // `vault 위생 (끊긴 링크 · 고아 · 태그 중복)` — 둘째 단어의 접두사.
    expect(isStrongCommandMatch("위생", "vault 위생 (끊긴 링크 · 고아 · 태그 중복)")).toBe(true);
    expect(isStrongCommandMatch("vault", "vault 위생 (끊긴 링크 · 고아 · 태그 중복)")).toBe(true);
    // 라벨 전체의 접두사도 강하다.
    expect(isStrongCommandMatch("vault 위", "vault 위생 (끊긴 링크 · 고아 · 태그 중복)")).toBe(true);
  });

  it("대소문자는 무시한다", () => {
    expect(isStrongCommandMatch("VAULT", "vault hygiene")).toBe(true);
  });

  /**
   * ⚠️ **승격 조건이 헐거우면 아무 질의나 명령을 위로 올린다.** 그러면 노트를 찾는 흔한
   * 흐름에서 명령이 계속 끼어든다 — 고치려던 것보다 나쁘다.
   */
  it("퍼지로만 맞는 것은 강하지 않다", () => {
    // 글자는 순서대로 다 있지만 어느 단어의 접두사도 아니다.
    expect(isStrongCommandMatch("vlt", "vault hygiene")).toBe(false);
    // 단어 중간부터 맞는 것도 아니다.
    expect(isStrongCommandMatch("생", "vault 위생")).toBe(false);
  });

  it("빈 질의는 강하지 않다 — 빈 흐름에서 전부 위로 올라오면 안 된다", () => {
    expect(isStrongCommandMatch("", "vault 위생")).toBe(false);
    expect(isStrongCommandMatch("   ", "vault 위생")).toBe(false);
  });

  it("groupResults가 강한 명령을 따로 낸다", () => {
    const strong: PaletteResult = {
      entry: { kind: "command", command: BUILTIN_COMMANDS[0], strong: true },
      score: 500,
    };
    const weak: PaletteResult = {
      entry: { kind: "command", command: BUILTIN_COMMANDS[1], strong: false },
      score: 400,
    };
    const g = groupResults([strong, weak]);
    expect(g.topCommands).toHaveLength(1);
    expect(g.commands).toHaveLength(1);
  });
});
