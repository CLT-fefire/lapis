import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 앵커 배선이 **끝까지 이어져 있는지** 소스로 확인한다.
 *
 * ## 왜 소스를 읽나
 *
 * 순수 부분(`resolveWikilink` · `findHeadingByAnchor`)은 단위 테스트가 고정한다.
 * 고정이 안 닿는 곳은 **그 둘을 잇는 배선**이다 — `jumpToWikilink`가 앵커를 심고
 * `+page.svelte`가 그걸 소비하는 부분.
 *
 * 그 배선이 빠지면 아무 에러도 안 난다. 링크는 파랗고, 눌리고, 노트도 열린다.
 * **스크롤만 안 한다.** 그리고 그건 "헤딩이 문서 맨 위 근처였나 보다"로 읽힌다.
 *
 * ⚠️ 문구가 아니라 **심볼**을 본다. 주석은 지운 뒤에 찾는다 — 이 파일이 설명하려고 쓴
 * 이름이 검사 대상으로 잡히면 가드가 자기 자신을 보고 통과한다(실제로 두 번 겪었다).
 */

const NL = String.fromCharCode(10);

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");

/** 블록·줄 주석을 지운다. 문자열 리터럴은 **건드리지 않는다** — 진짜 코드가 지워진다. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

const VAULT = stripComments(read("./stores/vault.ts"));
const PAGE = stripComments(read("../routes/+page.svelte"));
const OUTLINE = stripComments(read("./stores/outline.ts"));

describe("앵커 배선", () => {
  /** ⚠️ 카나리아 — 파일을 못 읽었으면 아래가 빈 문자열을 보고 전부 통과한다. */
  it("세 파일을 실제로 읽었다", () => {
    for (const [name, src] of [
      ["vault.ts", VAULT],
      ["+page.svelte", PAGE],
      ["outline.ts", OUTLINE],
    ] as const) {
      expect(src.length, name).toBeGreaterThan(500);
    }
  });

  /**
   * ⚠️ **경로가 둘이라 개수를 센다.** `[[#헤딩]]`(같은 문서)과 `[[노트#헤딩]]`(이동 뒤)이
   * 각각 심는다. "하나라도 있으면 통과"로 두면 한 쪽을 지워도 안 잡힌다 — 실제로 이
   * 가드를 카나리아로 깨 봤을 때 그렇게 통과했다.
   */
  it("jumpToWikilink 가 두 경로 모두에서 앵커를 심는다", () => {
    const i = VAULT.indexOf("export async function jumpToWikilink");
    const fn = VAULT.slice(i, VAULT.indexOf(NL + "}", i));
    expect(fn).toContain("resolveWikilink(");
    expect(fn).toContain("hit.sameDoc");
    expect(fn.match(/pendingHeadingAnchor\.set\(/g) ?? []).toHaveLength(2);
  });

  it("+page.svelte 가 그 앵커를 소비한다", () => {
    expect(PAGE).toContain("$pendingHeadingAnchor");
    expect(PAGE).toContain("findHeadingByAnchor(");
    expect(PAGE).toContain("jumpToHeading(");
  });

  /**
   * ⚠️ 소비 쪽이 **헤딩 목록을 같이 읽어야** 한다. 앵커만 보고 돌면 아직 이전 노트의
   * 목록일 수 있고, 그러면 같은 이름의 헤딩이 있을 때 제자리에서 스크롤한다.
   */
  it("소비 effect 가 헤딩 목록도 읽는다", () => {
    const i = PAGE.indexOf("$pendingHeadingAnchor");
    const block = PAGE.slice(i, PAGE.indexOf("});", i));
    expect(block).toContain("parsed.headings");
  });

  /** 심고 나서 안 지우면 다음 노트에서 또 스크롤한다. */
  it("소비하면서 지운다", () => {
    const i = PAGE.indexOf("$pendingHeadingAnchor");
    const block = PAGE.slice(i, PAGE.indexOf("});", i));
    expect(block).toContain("pendingHeadingAnchor.set(null)");
  });

  /**
   * ⚠️ 미리보기의 회색/파랑 판정과 클릭 판정이 **같은 함수**를 써야 한다. 갈라지면
   * 파란데 안 가거나 회색인데 가는 링크가 생긴다.
   */
  it("링크 색 판정도 resolveWikilink 를 쓴다", () => {
    expect(PAGE).toContain("resolveWikilink(");
    expect(PAGE).not.toContain("resolveTarget(");
  });

  /** slug 를 만드는 함수와 찾는 함수가 같아야 한다. 두 벌이 되면 조용히 어긋난다. */
  it("헤딩 찾기가 미리보기와 같은 slugify 를 쓴다", () => {
    expect(OUTLINE).toContain("markdownPlugins/headingAnchor");
    expect(OUTLINE).toContain("slugify(");
  });
});
