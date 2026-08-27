import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * **모든 설정 항목이 어떤 카테고리에는 속하는지** 본다.
 *
 * ## 왜 이 가드가 있나
 *
 * 예전 설정 화면은 섹션을 한 줄로 나열했다. 새 설정을 더하려면 **그냥 아래 붙이면 됐다.**
 *
 * v2.0.0에서 카테고리로 나누면서 그게 달라졌다 — 이제 모든 섹션이 `{#if cat === "…"}`
 * 안에 있어야 하고, 밖에 두면 **어느 카테고리에서도 안 보인다.** 컴파일도 되고 테스트도
 * 통과하고 화면만 비어 있다. 설정을 더한 사람은 자기 코드가 안 돌아간다고 생각하지
 * 배치를 의심하지 않는다.
 */

const SRC = readFileSync(
  fileURLToPath(new URL("./SettingsModal.svelte", import.meta.url)),
  "utf-8",
);

/** `<div class="settings-body">` 안쪽만 잘라낸다. 그 밖의 섹션은 이 가드의 대상이 아니다. */
function body(): string {
  const start = SRC.indexOf('<div class="settings-body">');
  const end = SRC.indexOf("<footer", start);
  return SRC.slice(start, end);
}

describe("설정 카테고리", () => {
  const b = body();

  /** ⚠️ 카나리아 — 잘라내기가 깨지면 아래가 빈 문자열을 보고 통과한다. */
  it("본문을 실제로 잘라냈다", () => {
    expect(b.length).toBeGreaterThan(500);
    expect(b).toContain("setting-row");
  });

  it("카테고리가 넷이고 script 선언과 맞는다", () => {
    const declared = [...SRC.matchAll(/\{ id: "([a-z]+)", label: \(\) => m\./g)].map((m) => m[1]);
    const used = [...b.matchAll(/\{#if cat === "([a-z]+)"\}/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(2);
    // 선언한 카테고리가 전부 본문에 나타나야 한다 — 아니면 그 탭이 항상 비어 있다.
    expect(new Set(used)).toEqual(new Set(declared));
  });

  /**
   * **핵심.** 섹션이 카테고리 블록 밖에 있으면 어디에도 안 보인다.
   * `{#if}` 안팎을 세어서 판단한다 — 열림 깊이가 0인 자리에 섹션이 있으면 밖이다.
   */
  it("모든 setting-row 가 카테고리 블록 안에 있다", () => {
    // ⚠️ 단순한 깊이 카운터로는 안 된다. 섹션 **안에도** `{#if}`가 있고(`{#if isDebug}` 등)
    //    `{/if}`는 그것도 닫는다. 처음엔 `{#if cat ===`만 세고 `{/if}`를 전부 감산했더니
    //    카운터가 음수로 흘러 **아무것도 못 잡는 가드**가 됐다. 스택으로 종류를 구분한다.
    const lines = b.split("\n");
    const stack: ("cat" | "other")[] = [];
    const orphans: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/\{#if cat === "/.test(l)) stack.push("cat");
      else if (/\{#if\s/.test(l) || /\{#each\s/.test(l)) stack.push("other");
      else if (/\{\/if\}/.test(l) || /\{\/each\}/.test(l)) stack.pop();
      else if (/<section class="setting-row"/.test(l) && !stack.includes("cat")) {
        orphans.push(i + 1);
      }
    }
    expect(
      orphans,
      "카테고리 밖에 있는 설정 섹션 — 어느 탭에서도 안 보인다 (본문 기준 줄):\n  " +
        orphans.join(", "),
    ).toEqual([]);
  });

  /** 사용자 CSS 편집기는 고급에 있어야 한다 — 되돌리는 법을 그 화면이 안내한다. */
  it("사용자 CSS 편집기가 고급 카테고리에 있다", () => {
    const adv = b.slice(b.indexOf('{#if cat === "advanced"}'));
    expect(adv).toContain("<CustomCssEditor />");
  });
});
