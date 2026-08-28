import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 테이블 뷰의 **겹침 순서**.
 *
 * ⚠️ 겹침은 조용히 틀린다. 컬럼 메뉴와 sticky 헤더가 **둘 다 `z-index: 1`** 이었고,
 * 같은 값이면 **DOM 순서가 이긴다** — 표가 툴바보다 뒤에 있어서 헤더가 메뉴를 덮었다.
 * 메뉴는 열리고 항목도 있는데 첫 줄들이 헤더 뒤로 사라진다. 에러는 없고, 콘솔도 조용하다.
 *
 * happy-dom 에는 레이아웃·페인트가 없어 DOM 테스트로는 볼 수 없다. 소스를 읽는 가드다.
 */

const SRC = (() => {
  const raw = readFileSync(fileURLToPath(new URL("./TableView.svelte", import.meta.url)), "utf-8");
  // 주석을 지운다 — 안 지우면 가드가 자기 설명 문구에 맞는다.
  return raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
})();

/** 선택자 블록 안의 `z-index` 값. 없으면 null. */
function zOf(selector: string): number | null {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*\\{([^}]*)\\}`);
  const m = SRC.match(re);
  expect(m, `${selector} 규칙을 못 찾았다`).not.toBeNull();
  const z = m![1].match(/z-index:\s*(-?\d+)/);
  return z ? Number(z[1]) : null;
}

describe("테이블 뷰 겹침", () => {
  /** ⚠️ 카나리아 — 소스를 못 읽었으면 아래가 전부 통과하면서 아무것도 안 본다. */
  it("소스를 실제로 읽었다", () => {
    expect(SRC).toContain("thead th");
    expect(SRC).toContain(".menu {");
  });

  it("컬럼 메뉴가 sticky 헤더보다 위다", () => {
    const menu = zOf(".menu");
    const head = zOf("thead th");
    expect(menu, "컬럼 메뉴에 z-index 가 없다").not.toBeNull();
    expect(head, "sticky 헤더에 z-index 가 없다").not.toBeNull();
    expect(menu!, `메뉴 ${menu} ≤ 헤더 ${head} — 메뉴가 헤더 뒤로 숨는다`).toBeGreaterThan(head!);
  });

  /** sticky 헤더는 행 위에 있어야 한다 — 없으면 스크롤할 때 행이 헤더를 덮는다. */
  it("sticky 헤더가 겹침 값을 갖는다", () => {
    expect(zOf("thead th")).toBeGreaterThan(0);
  });
});
