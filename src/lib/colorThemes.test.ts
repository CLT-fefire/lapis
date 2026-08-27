import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BASE_RAMP,
  COLOR_THEMES,
  DEFAULT_THEME_ID,
  accentForeground,
  accentTrio,
  contrastRatio,
  findTheme,
  hexToRgb,
  rgbToHsl,
  themeCss,
  tintNeutral,
  type ColorTheme,
} from "./colorThemes";

/**
 * 색 테마 스물여섯이 **전부 읽히는지** 본다.
 *
 * ## 왜 이 테스트가 이 기능의 핵심인가
 *
 * 테마를 손으로 스물여섯 개 색 맞추면 **그중 몇 개는 반드시 안 읽힌다.** 그리고 안 읽히는
 * 테마는 오류가 아니라 그냥 보기 나쁜 화면이라, 그 테마를 고른 사람만 겪는다.
 *
 * 그래서 설계를 성질로 잡았다 — **색조가 WCAG 상대휘도를 보존한다.** 대비비는 휘도만으로
 * 정해지므로 휘도를 보존하면 대비도 보존된다. 이 테스트는 그 성질이 실제로 성립하는지,
 * 그리고 액센트 쪽(휘도를 물려받을 수 없는 유일한 곳)이 계산으로 안전한지 본다.
 */

const AA = 4.5;

describe("램프 기준선", () => {
  /**
   * ⚠️ `BASE_RAMP`가 `app.css`와 갈리면 색조 계산이 **다른 휘도**를 기준으로 돌아간다.
   * 그러면 "휘도를 보존한다"는 이 설계의 전제가 조용히 깨진다.
   */
  it("app.css 의 :root 램프와 같다", () => {
    const css = readFileSync(fileURLToPath(new URL("../app.css", import.meta.url)), "utf-8");
    const inCss: Record<string, string> = {};
    for (const m of css.matchAll(/^\s+(--n-\d+):\s*(#[0-9a-f]{6});/gim)) {
      inCss[m[1]] = m[2].toLowerCase();
    }
    // ⚠️ 개수를 손으로 적지 않는다. 3.0에서 램프가 13 → 15단이 되면서 이 숫자가
    //    먼저 깨졌는데, 정작 확인하려던 것은 "두 목록이 같은가"다.
    expect(Object.keys(inCss).length, "app.css 에서 램프를 못 읽었다").toBeGreaterThan(8);
    expect(inCss).toEqual(BASE_RAMP);
  });
});

describe("프리셋 목록", () => {
  it("스물 이상이고 id가 겹치지 않는다", () => {
    expect(COLOR_THEMES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(COLOR_THEMES.map((t) => t.id)).size).toBe(COLOR_THEMES.length);
  });

  it("기본 테마가 목록에 있다", () => {
    expect(findTheme(DEFAULT_THEME_ID)).toBeDefined();
  });

  /** 기본은 `app.css` 그대로다 — 덮어쓸 것이 없으면 아무것도 주입하지 않는다. */
  it("기본 테마는 빈 CSS를 낸다", () => {
    expect(themeCss(DEFAULT_THEME_ID)).toBe("");
    expect(themeCss("없는-테마-id")).toBe("");
  });
});

describe("액센트 — 계산으로 안전하다", () => {
  it.each(COLOR_THEMES)("$name 의 액센트 글자색이 AA다", (t) => {
    const fg = accentForeground(t.accent);
    expect(
      contrastRatio(fg, t.accent),
      `${t.name}: ${fg} on ${t.accent} 가 안 읽힌다`,
    ).toBeGreaterThanOrEqual(AA);
  });

  /**
   * 액센트는 테두리·아이콘·강조 글자로도 쓰인다. 본문 배경 위에서 **최소한 큰 글자 기준**은
   * 넘어야 한다. (기본 Blurple도 2.74라 AA는 못 넘는다 — 그건 채워진 배경이 주 용도이기
   * 때문이고, 그 조합은 위 테스트가 본다.)
   */
  it.each(COLOR_THEMES)("$name 의 액센트가 본문 배경에서 형체는 보인다", (t) => {
    // 본문 배경은 --n-300. 색조가 있으면 그것도 반영해서 잰다.
    const bg = t.tint ? tintNeutral(BASE_RAMP["--n-300"], t.tint, t.tintStrength ?? 0.22) : BASE_RAMP["--n-300"];
    expect(contrastRatio(t.accent, bg), `${t.name}`).toBeGreaterThanOrEqual(2);
  });

  /**
   * ⚠️ **밝은 액센트에 흰 글자를 고정으로 쓰면 안 읽힌다.** 계산이 실제로 검은 글자를
   * 고르는지 못 박는다 — 안 그러면 `accentForeground`가 늘 흰색을 내도 위 테스트가 통과한다.
   */
  it("밝은 액센트에는 검은 글자를 고른다", () => {
    expect(accentForeground("#f0e14a")).toBe("#0b0b0d");
    expect(accentForeground("#5865f2")).toBe("#ffffff");
  });
});

describe("색조 — 휘도를 보존한다", () => {
  const tinted = COLOR_THEMES.filter((t) => t.tint);

  it("색조가 있는 테마가 여럿이다", () => {
    expect(tinted.length).toBeGreaterThanOrEqual(8);
  });

  /**
   * **이 설계의 핵심 성질.** 대비비는 휘도만으로 정해지므로, 휘도를 보존하면 대비가
   * 정확히 보존된다 — 어떤 색을 골라도 기본 다크와 같은 가독성이다.
   *
   * ⚠️ 처음엔 이 테스트가 **HSL 명도(L)** 보존을 단언했다. 그건 틀린 축이다 — L을 고정해도
   * 채도를 올리면 휘도가 움직이고, 실제로 여섯 테마에서 `--text-muted`가 AA 아래로
   * 떨어졌다. 임계값을 낮추는 대신 **재는 축을 바로잡았다.**
   */
  it.each(tinted)("$name 이 램프의 휘도를 바꾸지 않는다", (t) => {
    for (const [name, base] of Object.entries(BASE_RAMP)) {
      const out = tintNeutral(base, t.tint!, t.tintStrength ?? 0.22);
      // 8비트로 반올림되므로 완전히 같지는 않다. 대비비로 환산해 무시할 수준인지 본다.
      expect(
        contrastRatio(base, out),
        `${t.name} ${name}: ${base} → ${out}`,
      ).toBeLessThan(1.06);
    }
  });

  /** 휘도가 같으니 본문 대비도 기본과 같아야 한다 — 성질을 결과로 한 번 더 확인한다. */
  it.each(tinted)("$name 에서 본문 글자가 여전히 AA다", (t) => {
    const bg = tintNeutral(BASE_RAMP["--n-300"], t.tint!, t.tintStrength ?? 0.22);
    const fg = tintNeutral(BASE_RAMP["--n-900"], t.tint!, t.tintStrength ?? 0.22);
    expect(contrastRatio(fg, bg), `${t.name}`).toBeGreaterThanOrEqual(AA);
  });

  it.each(tinted)("$name 에서 보조 글자도 AA다", (t) => {
    const bg = tintNeutral(BASE_RAMP["--n-300"], t.tint!, t.tintStrength ?? 0.22);
    const muted = tintNeutral(BASE_RAMP["--n-700"], t.tint!, t.tintStrength ?? 0.22);
    expect(contrastRatio(muted, bg), `${t.name}`).toBeGreaterThanOrEqual(AA);
  });

  /** 색조가 **실제로 보여야** 한다 — 안 그러면 스물여섯이 다 같은 회색이다. */
  it.each(tinted)("$name 의 색조가 실제로 회색을 벗어난다", (t) => {
    const out = tintNeutral(BASE_RAMP["--n-300"], t.tint!, t.tintStrength ?? 0.22);
    expect(rgbToHsl(hexToRgb(out))[1], `${t.name}: ${out} 가 회색 그대로다`).toBeGreaterThan(0.02);
  });
});

describe("생성된 CSS", () => {
  it.each(COLOR_THEMES.filter((t) => t.id !== DEFAULT_THEME_ID))("$name 이 :root 규칙을 낸다", (t) => {
    const css = themeCss(t.id);
    expect(css).toMatch(/^:root \{/);
    expect(css).toContain("--accent:");
    expect(css).toContain("--accent-fg:");
    if (t.tint) expect(css).toContain("--n-300:");
    else expect(css).not.toContain("--n-300:");
  });

});

describe("⚠️ 액센트 셋 — 26종 전부", () => {
  /**
   * v2.x 의 Blurple 은 채움에 맞춰 고른 값인데 **링크에도 쓰여** 글자 대비 3.7:1 이었다.
   * 3.0 은 셋으로 나눴고, 그 셋이 **테마마다** 제 몫을 해야 한다.
   *
   * ⚠️ 이 검사가 없으면 프리셋을 하나 더할 때 그 테마만 조용히 미달이 된다.
   */
  const AA = 4.5;
  const NON_TEXT = 3;
  /** 테마가 tint 를 주면 본문 면도 물든다 — 그 면 위에서 재야 맞다. */
  const contentFor = (t: ColorTheme) =>
    t.tint ? tintNeutral(BASE_RAMP["--n-300"], t.tint, t.tintStrength ?? 0.22) : BASE_RAMP["--n-300"];

  for (const t of COLOR_THEMES) {
    it(`${t.id}: 글자 액센트가 AA 를 넘는다`, () => {
      const r = contrastRatio(accentTrio(t).text, contentFor(t));
      expect(r, `${t.id} ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
    });

    it(`${t.id}: 채움 위의 글자가 AA 를 넘는다`, () => {
      const solid = accentTrio(t).solid;
      const r = contrastRatio(accentForeground(solid), solid);
      expect(r, `${t.id} ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
    });

    /** `--accent` 는 포커스 링·보더용이다 — 비문자 기준 3:1. */
    it(`${t.id}: 선 액센트가 비문자 기준을 넘는다`, () => {
      const r = contrastRatio(t.accent, contentFor(t));
      expect(r, `${t.id} ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(NON_TEXT);
    });
  }

  /** ⚠️ 파생이 **색상**을 흔들면 26종이 서로 닮아 간다. 밝기 한 축만 움직인다. */
  it("파생은 밝기만 바꾼다", () => {
    // ⚠️ 정확히 같기를 요구하지 않는다. hex 로 내려가면서 8비트로 반올림되어 색상이
    //    1~2도 흔들린다 — 그건 색상을 바꾼 게 아니라 표현 한계다. 처음엔 정수 일치로
    //    적었다가 그 반올림에 걸렸다.
    const TOLERANCE_DEG = 3;
    for (const t of COLOR_THEMES) {
      const trio = accentTrio(t);
      const hue = (hx: string) => rgbToHsl(hexToRgb(hx))[0] * 360;
      const gap = (a: string) => Math.abs(hue(a) - hue(t.accent));
      expect(gap(trio.solid), `${t.id} solid`).toBeLessThanOrEqual(TOLERANCE_DEG);
      expect(gap(trio.text), `${t.id} text`).toBeLessThanOrEqual(TOLERANCE_DEG);
    }
  });

  /** 셋이 실제로 다른 값이어야 한다 — 같으면 나눈 의미가 없다. */
  it("셋이 서로 다르다", () => {
    for (const t of COLOR_THEMES) {
      const trio = accentTrio(t);
      expect(new Set([trio.solid, trio.base, trio.text]).size, t.id).toBe(3);
    }
  });

  /** 테마를 고르면 셋이 **전부** 나가야 한다. 하나 빠지면 그 요소만 기본색으로 남는다. */
  it("themeCss 가 셋을 다 낸다", () => {
    const css = themeCss(COLOR_THEMES.find((t) => t.id !== DEFAULT_THEME_ID)!.id);
    for (const n of ["--accent-solid:", "--accent:", "--accent-text:"]) {
      expect(css, n).toContain(n);
    }
  });
});
