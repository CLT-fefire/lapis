import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 필터 칩의 **활성 표시**.
 *
 * ## 🔴 두 번 같은 실수를 했다
 *
 * 활성 스타일이 축마다 따로 있었다(`.kind-chip.active` · `.topic-chip.active`). 축을
 * 더하면서 규칙을 같이 안 쓰면 **칩이 켜져도 아무 표시가 안 난다** — 목록은 걸러지는데
 * 무엇을 골랐는지 화면이 말하지 않는다. 에러는 없고 테스트도 통과한다.
 *
 * 폴더 축(v3.1.0)과 임의 frontmatter 축(v3.3.0)이 **둘 다** 그 상태로 나갔다.
 * 프리뷰에 vault 가 없어 필터 패널을 띄울 수 없었던 것이 겹쳤다.
 */

const SRC = (() => {
  const raw = readFileSync(fileURLToPath(new URL("./FilterPanel.svelte", import.meta.url)), "utf-8");
  // 주석을 지운다 — 안 지우면 가드가 자기 설명 문구에 맞는다.
  return raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
})();

/** 마크업에 실제로 쓰인 칩 종류 — `class="facet-chip xxx-chip"`. */
function chipVariants(): string[] {
  const out = new Set<string>();
  for (const m of SRC.matchAll(/class="facet-chip ([a-z-]+)"/g)) out.add(m[1]);
  return [...out].sort();
}

describe("칩 활성 표시", () => {
  /** ⚠️ 카나리아 — 마크업을 실제로 읽었는지. 0종을 읽고 통과하면 아무것도 안 본 것이다. */
  it("칩 종류를 실제로 찾았다", () => {
    expect(chipVariants().length).toBeGreaterThanOrEqual(4);
  });

  /**
   * 🔴 **기본 규칙이 있어야 한다.** 축마다 색은 달라도 되지만 "켜졌다"는 사실은 한 곳에서
   * 와야 한다 — 안 그러면 새 축이 조용히 표시를 잃는다.
   */
  it("모든 칩에 걸리는 활성 규칙이 있다", () => {
    expect(
      SRC,
      "`.facet-chip.active` 가 없으면 축을 더할 때마다 표시를 빼먹는다",
    ).toMatch(/\.facet-chip\.active\s*\{/);
  });

  /**
   * 각 축이 **적어도 하나의** 활성 규칙에 닿는지. 기본 규칙이 있으면 전부 통과하지만,
   * 누군가 기본을 지우고 축별로 되돌리면 여기가 운다.
   */
  it("쓰인 칩 종류마다 활성 스타일이 닿는다", () => {
    const hasBase = /\.facet-chip\.active\s*\{/.test(SRC);
    const missing = chipVariants().filter(
      (v) => !hasBase && !new RegExp(`\\.${v}\\.active\\s*\\{`).test(SRC),
    );
    expect(
      missing,
      `활성 표시가 없는 칩: ${missing.join(", ")} — 켜져도 화면이 아무 말을 안 한다`,
    ).toEqual([]);
  });

  /** ⚠️ `class:active` 를 안 걸면 CSS 가 있어도 소용없다. */
  it("칩마다 active 를 실제로 토글한다", () => {
    const chipBlocks = SRC.match(/class="facet-chip [a-z-]+"[\s\S]{0,200}?>/g) ?? [];
    expect(chipBlocks.length).toBe(chipVariants().length);
    for (const b of chipBlocks) {
      expect(b, `class:active 가 없는 칩이 있다:\n${b}`).toMatch(/class:active/);
    }
  });
});
