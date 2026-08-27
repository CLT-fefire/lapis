import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRootTokens, buildRootTokenBlock } from "./previewExportDoc";

/**
 * CLI 내보내기용 토큰 해석.
 *
 * ## ⚠️ 앱과 CLI가 값을 얻는 길이 다르다
 *
 * 앱은 `getComputedStyle`로 **살아 있는 값**을 읽는다 — 사용자가 고른 색 테마와 사용자
 * 정의 CSS가 이미 반영된 값이다. CLI에는 브라우저가 없으니 `app.css`의 `:root`를 직접
 * 읽는다.
 *
 * 그래서 같은 노트를 앱과 CLI로 내보내면 **색이 다를 수 있다.** 그건 숨길 게 아니라
 * 적어야 하는 것이다 — `cli/README.md`에 있다.
 */

const APP_CSS = readFileSync(
  fileURLToPath(new URL("../app.css", import.meta.url)),
  "utf-8",
);

describe("parseRootTokens", () => {
  it("`:root` 의 커스텀 프로퍼티를 읽는다", () => {
    const t = parseRootTokens(":root {\n  --a: #fff;\n  --b: var(--a);\n}");
    expect(t.get("--a")).toBe("#fff");
    expect(t.get("--b")).toBe("var(--a)");
  });

  /** ⚠️ `:root` 밖의 선언은 조건부다 — 무조건 가져오면 틀린 값이 박제된다. */
  it("`:root` 밖은 안 읽는다", () => {
    const t = parseRootTokens(".card {\n  --x: red;\n}");
    expect(t.has("--x")).toBe(false);
  });

  /**
   * ⚠️ `:root[data-density="compact"]` 같은 **조건부 root**도 안 읽는다. 밀도를
   * 안 고른 사람의 문서에 compact 값이 박히면 안 된다.
   */
  it("조건이 붙은 root 는 안 읽는다", () => {
    const t = parseRootTokens(':root[data-density="compact"] {\n  --sp-3: 2px;\n}');
    expect(t.has("--sp-3")).toBe(false);
  });

  it("주석과 빈 줄을 넘긴다", () => {
    const t = parseRootTokens(":root {\n  /* 설명 */\n\n  --a: 1px;\n}");
    expect(t.get("--a")).toBe("1px");
    expect(t.size).toBe(1);
  });

  it("값에 콜론이 있어도 자르지 않는다", () => {
    const t = parseRootTokens(":root { --u: url(data:image/png;base64,AA); }");
    expect(t.get("--u")).toBe("url(data:image/png;base64,AA)");
  });
});

describe("실제 app.css", () => {
  const tokens = parseRootTokens(APP_CSS);

  /** ⚠️ 카나리아 — 파싱이 깨지면 아래가 빈 맵을 보고 통과한다. */
  it("토큰을 실제로 읽었다", () => {
    expect(tokens.size).toBeGreaterThan(50);
  });

  it("핵심 토큰이 들어 있다", () => {
    for (const k of ["--accent", "--text-primary", "--surface-content", "--danger-text"]) {
      expect(tokens.get(k), `${k} 를 못 읽었다`).toBeTruthy();
    }
  });

  /** compact 밀도 값이 새어 들어오면 안 된다. */
  it("기본 밀도 값을 쓴다", () => {
    const compact = /:root\[data-density="compact"\]\s*{([^}]*)}/.exec(APP_CSS);
    expect(compact, "compact 블록이 없다 — 이 검사가 헛돈다").not.toBeNull();
    const overridden = [...compact![1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)];
    expect(overridden.length).toBeGreaterThan(0);
    for (const [, name, value] of overridden) {
      expect(tokens.get(name), `${name} 가 compact 값으로 박혔다`).not.toBe(value.trim());
    }
  });

  /** 내보낸 문서가 실제로 값을 갖는지 — 해석기와 조립기가 맞물리는지 본다. */
  it("토큰 블록이 만들어진다", () => {
    const block = buildRootTokenBlock(
      ".x { color: var(--text-primary); background: var(--surface-content); }",
      (n) => tokens.get(n) ?? "",
    );
    expect(block).toContain("--text-primary:");
    expect(block).toContain("--surface-content:");
    // 중첩 var() 를 따라간다
    expect(block).toMatch(/--n-\d+:/);
  });
});
