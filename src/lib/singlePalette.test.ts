import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * **팔레트가 하나인지** 본다.
 *
 * ## 왜 이 가드가 있나
 *
 * 예전 `app.css`는 같은 토큰을 **세 곳**에 정의했다 — `:root`(다크),
 * `[data-theme="light"]`, 그리고 `@media (prefers-color-scheme: light)` 안의
 * `[data-theme="system"]`. 뒤의 둘은 **값까지 중복**이라 파일 주석이 이렇게 경고했다:
 *
 * > 위 `[data-theme="light"]` 블록과 **항상 함께** 수정할 것.
 *
 * 사람에게 맡긴 규칙이고, 어긋나도 **아무 에러가 안 난다.** 라이트에서만 색이 틀리는데,
 * 다크만 쓰는 사람은 영원히 모른다.
 *
 * v2.0.0에서 테마를 다크 하나로 줄이면서 그 중복을 지웠다. 이 가드는 **다시 생기는 것**을
 * 막는다.
 *
 * ⚠️ 막으려는 것은 "라이트 테마" 자체가 아니라 **같은 토큰의 두 번째 정의**다. 색을 바꾸는
 * 길은 사용자 정의 CSS이고, 그건 이 파일을 안 건드린다.
 */

const CSS = readFileSync(fileURLToPath(new URL("../app.css", import.meta.url)), "utf-8");

/** 주석을 걷어낸 CSS. 설명문에 적힌 옛 선택자를 규칙으로 오인하면 안 된다. */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, " ");

describe("팔레트는 하나다", () => {
  /** ⚠️ 카나리아 — 파일을 못 읽거나 주석 제거가 다 먹으면 아래가 무의미해진다. */
  it("CSS를 실제로 읽었고 토큰이 들어 있다", () => {
    expect(CODE.length).toBeGreaterThan(3000);
    expect(CODE).toContain("--surface-base");
    expect(CODE).toContain(":root");
  });

  /**
   * 토큰을 정의하는 블록을 선택자별로 모은다.
   *
   * ⚠️ 처음엔 "토큰이 파일 전체에서 두 번 나오면 실패"로 썼다가 **`[data-density="compact"]`
   * 를 잡았다.** 그건 의도된 변형이다(조밀 모드가 간격 토큰 다섯 개를 덮어쓴다).
   *
   * 막으려는 것은 **두 번째 팔레트**지 변형 자체가 아니다. 그래서 변형 선택자를 허용 목록에
   * 두고, **새 변형을 더하려면 여기도 손대게** 만든다 — 그 손댐이 "이게 두 번째 팔레트인가"를
   * 한 번 생각하게 하는 자리다.
   */
  // 밀도는 팔레트가 아니라 **간격**만 바꾼다 — 아래 "변형이 팔레트 절반을 덮으면 안 된다"가
  // 그걸 지킨다. 3.0에서 `cozy` 가 늘었다.
  const ALLOWED_VARIANTS = [
    `:root[data-density="compact"]`,
    `:root[data-density="cozy"]`,
  ];

  function blocks(): { selector: string; tokens: string[] }[] {
    const out: { selector: string; tokens: string[] }[] = [];
    for (const m of CODE.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const tokens = [...m[2].matchAll(/(--[\w-]+)\s*:/g)].map((t) => t[1]);
      if (tokens.length > 0) out.push({ selector: m[1].trim(), tokens });
    }
    return out;
  }

  it("토큰을 정의하는 블록이 :root 와 허용된 변형뿐이다", () => {
    const unexpected = blocks()
      .map((b) => b.selector)
      .filter((sel) => sel !== ":root" && !ALLOWED_VARIANTS.includes(sel));
    expect(
      unexpected,
      "토큰을 정의하는 새 블록이 생겼다. 두 번째 팔레트라면 지우고, 의도된 변형이라면 " +
        "ALLOWED_VARIANTS 에 더해라:\n  " + unexpected.join("\n  "),
    ).toEqual([]);
  });

  it("한 블록 안에서 같은 토큰을 두 번 정의하지 않는다", () => {
    const dup: string[] = [];
    for (const b of blocks()) {
      const seen = new Set<string>();
      for (const t of b.tokens) {
        if (seen.has(t)) dup.push(`${b.selector} { ${t} }`);
        seen.add(t);
      }
    }
    expect(dup, "같은 블록에서 두 번 정의됐다 — 뒤엣것이 이긴다:\n  " + dup.join("\n  ")).toEqual(
      [],
    );
  });

  /** 변형은 **일부만** 덮어써야 한다. 팔레트 전체를 덮으면 그게 두 번째 팔레트다. */
  it("변형 블록이 팔레트 전체를 덮지 않는다", () => {
    const base = blocks().find((b) => b.selector === ":root");
    expect(base, ":root 블록을 못 찾았다").toBeDefined();
    for (const b of blocks()) {
      if (b.selector === ":root") continue;
      expect(
        b.tokens.length,
        `${b.selector} 가 토큰 ${b.tokens.length}개를 덮는다 — 변형이 아니라 두 번째 팔레트다`,
      ).toBeLessThan(base!.tokens.length / 2);
    }
  });

  /**
   * 두 번째 팔레트가 들어오는 **두 입구**를 막는다. 규칙으로 존재하면 안 된다
   * (주석에서 설명하는 것은 위에서 걷어냈으므로 걸리지 않는다).
   */
  it("두 번째 팔레트를 여는 선택자가 없다", () => {
    expect(CODE, "라이트 테마 블록이 다시 생겼다").not.toMatch(/\[data-theme=["']light["']\]/);
    expect(CODE, "OS 외관에 따라 갈리는 블록이 다시 생겼다").not.toMatch(
      /@media[^{]*prefers-color-scheme/,
    );
  });

  /**
   * `data-theme` 속성 자체는 **남겨 뒀다.** 사용자 CSS가 앵커로 쓸 수 있고, 나중에 테마가
   * 다시 늘어날 여지를 없앨 이유가 없다. 지워지지 않았는지 못 박는다.
   */
  it("data-theme 앵커는 남아 있다", () => {
    const boot = readFileSync(fileURLToPath(new URL("../app.html", import.meta.url)), "utf-8");
    expect(boot).toMatch(/dataset\.theme\s*=\s*["']dark["']/);
  });
});
