import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseNote } from "./markdown";
import { collectCssVarNames, buildRootTokenBlock } from "./previewExportDoc";
import { contrastRatio, BASE_RAMP } from "./colorThemes";
import { CALLOUT_KINDS } from "./markdownPlugins/callout";

/**
 * 콜아웃 — `> [!WARNING]`.
 *
 * ## 왜 만들었나
 *
 * 실측: 이 vault의 41파일 218곳이 `⚠️ **…**` 로 **손으로 만든 콜아웃**을 쓰고 있다.
 * 문법이 없어서 굵은 글씨와 이모지로 흉내 낸 것이다.
 *
 * ## ⚠️ GitHub의 다섯 종만 넣는다
 *
 * Obsidian은 열두 종 넘게 받지만 이 vault의 문서는 **GitHub에서도 읽힌다**(저장소가
 * 공개고 `README`·`CHANGELOG`가 거기서 렌더된다). 교집합 밖을 쓰면 한쪽에서만 뜬다.
 *
 * ⚠️ 이 문법의 진짜 장점은 **곱게 무너지는 것**이다. 지원하지 않는 도구에서는
 * `[!WARNING]` 글자가 보이는 평범한 인용문이 된다 — 깨지지 않는다.
 */

const html = (src: string) => parseNote(src).html;

describe("찾는 것", () => {
  it("다섯 종을 전부 안다", () => {
    expect([...CALLOUT_KINDS]).toEqual([
      "note",
      "tip",
      "important",
      "warning",
      "caution",
    ]);
  });

  for (const kind of CALLOUT_KINDS) {
    it(`${kind} 를 콜아웃으로 그린다`, () => {
      const out = html(`> [!${kind.toUpperCase()}]\n> 본문`);
      expect(out).toContain(`class="callout callout-${kind}"`);
      expect(out).toContain("본문");
    });
  }

  it("대소문자를 가리지 않는다", () => {
    expect(html("> [!Warning]\n> x")).toContain("callout-warning");
    expect(html("> [!warning]\n> x")).toContain("callout-warning");
  });

  /** 표식 줄 뒤에 제목을 붙일 수 있다 — GitHub·Obsidian 공통. */
  it("표식 줄의 나머지가 제목이 된다", () => {
    const out = html("> [!NOTE] 읽는 법\n> 본문");
    expect(out).toContain("callout-title");
    expect(out).toContain("읽는 법");
  });

  it("제목이 없으면 종류 이름을 쓴다", () => {
    expect(html("> [!TIP]\n> x")).toContain(">Tip<");
  });

  /** 콜아웃 안에서도 마크다운이 산다 — 인용문이 원래 그렇다. */
  it("본문의 마크다운을 그대로 그린다", () => {
    const out = html("> [!NOTE]\n> **굵게** 와 `코드`");
    expect(out).toContain("<strong>굵게</strong>");
    expect(out).toContain("<code>코드</code>");
  });
});

describe("⚠️ 안 건드리는 것", () => {
  /** 인용문 97줄이 이 vault에 있다. 그게 전부 콜아웃이 되면 안 된다. */
  it("평범한 인용문은 그대로 둔다", () => {
    const out = html("> 그냥 인용");
    expect(out).toContain("<blockquote>");
    expect(out).not.toContain("callout");
  });

  /** ⚠️ 모르는 종류를 콜아웃으로 만들면 GitHub와 갈린다. 인용문으로 남긴다. */
  it("모르는 종류는 콜아웃이 아니다", () => {
    const out = html("> [!QUESTION]\n> x");
    expect(out).not.toContain("callout");
    expect(out).toContain("[!QUESTION]");
  });

  it("표식이 첫 줄이 아니면 콜아웃이 아니다", () => {
    expect(html("> 머리말\n> [!NOTE]")).not.toContain("callout");
  });

  /** 코드 블록 안의 예시가 렌더되면 문서로 설명을 못 쓴다. */
  it("코드 펜스 안은 건드리지 않는다", () => {
    const out = html("```md\n> [!NOTE]\n> x\n```");
    expect(out).not.toContain("callout-note");
  });
});

describe("헤딩 아웃라인과 섞이지 않는다", () => {
  /** ⚠️ 콜아웃 제목은 헤딩이 아니다. 아웃라인에 들어가면 목차가 오염된다. */
  it("콜아웃 제목은 아웃라인에 안 들어간다", () => {
    const { headings } = parseNote("# 진짜 헤딩\n\n> [!NOTE] 가짜 제목\n> x");
    expect(headings.map((h) => h.text)).toEqual(["진짜 헤딩"]);
  });
});

describe("⚠️ 내보낸 HTML에서도 색이 산다", () => {
  /**
   * 자립 HTML 내보내기는 `rendered.css`를 인라인하고, **거기서 실제로 쓰인 토큰만**
   * `:root`에 풀어 넣는다. 콜아웃 색이 그 추출에 안 잡히면 내보낸 문서에서만 회색이
   * 된다 — 앱에서는 멀쩡해서 **아무도 모른다.**
   */
  const CSS = readFileSync(
    fileURLToPath(new URL("./styles/rendered.css", import.meta.url)),
    "utf-8",
  );

  it("다섯 종의 색 토큰이 전부 추출된다", () => {
    const names = new Set(collectCssVarNames(CSS));
    // ⚠️ caution 은 `--danger` 가 아니라 `--danger-text` 다 — 원래 값은 글자색으로
    //    AA 미달이었다(`dangerText.test.ts`).
    for (const t of ["--accent", "--success", "--violet", "--warning", "--danger-text"]) {
      expect(names.has(t), `${t} 가 rendered.css 에서 안 잡힌다`).toBe(true);
    }
  });

  /** 컴포넌트 지역 프로퍼티는 `:root`에 없다 — CSS의 fallback이 살아야 한다. */
  it("--callout-color 는 :root 에 선언되지 않는다", () => {
    const known: Record<string, string> = { "--accent": "#5865f2" };
    const block = buildRootTokenBlock(CSS, (n) => known[n] ?? "");
    expect(block).not.toContain("--callout-color");
  });
});

describe("⚠️ 제목이 읽히는가 — 브라우저에서 재고 박제한다", () => {
  /**
   * 콜아웃을 처음 넣었을 때 다섯 종의 제목이 **전부 같은 색**이었다. 테스트는 전부
   * 통과했다 — 구조만 봤기 때문이다. 브라우저에서 계산된 색을 읽어 보고 알았고,
   * 그때 `note` 2.37:1 · `caution` 3.03:1 로 **둘이 AA 미달**인 것도 같이 나왔다.
   *
   * ⚠️ 제목은 16px/600이라 WCAG의 \"큰 글씨\"(18.66px 굵게)가 아니다 — **4.5가 기준**이다.
   *
   * 여기서 다시 재는 이유는 그 측정을 **한 번으로 끝내지 않기 위해서**다. 색을 바꾸면
   * 여기가 빨개진다.
   */
  const AA = 4.5;

  /** app.css 의 값을 그대로 옮긴 것. `BASE_RAMP` 밖의 상태색만 따로 적는다. */
  const TOKEN: Record<string, string> = {
    "--surface-content": BASE_RAMP["--n-100"],
    "--text-primary": BASE_RAMP["--n-900"],
    "--success": "#2dc770",
    "--violet": "#c4a3ff",
    "--warning": "#f0b232",
    "--danger-text": "#f88d90",
    "--danger": "#f23f43",
  };

  /** rgba 틴트를 본문 배경 위에 합성한다 — 실제로 눈에 닿는 색은 이것이다. */
  const over = (rgba: [number, number, number, number], base: string): string => {
    const b = [1, 3, 5].map((i) => parseInt(base.slice(i, i + 2), 16));
    const [r, g, bl, a] = rgba;
    const mix = [r, g, bl].map((c, i) => Math.round(c * a + b[i] * (1 - a)));
    return `#${mix.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  };

  const CONTENT = TOKEN["--surface-content"];

  const CASES: { kind: string; fg: string; bg: string }[] = [
    { kind: "note", fg: TOKEN["--text-primary"], bg: BASE_RAMP["--n-0"] },
    { kind: "tip", fg: TOKEN["--success"], bg: over([45, 199, 112, 0.12], CONTENT) },
    { kind: "important", fg: TOKEN["--violet"], bg: over([168, 119, 232, 0.16], CONTENT) },
    { kind: "warning", fg: TOKEN["--warning"], bg: over([240, 178, 50, 0.12], CONTENT) },
    { kind: "caution", fg: TOKEN["--danger-text"], bg: over([242, 63, 67, 0.12], CONTENT) },
  ];

  for (const c of CASES) {
    it(`${c.kind} 제목이 AA를 넘는다`, () => {
      const r = contrastRatio(c.fg, c.bg);
      expect(r, `${c.kind}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
    });
  }

  /** ⚠️ 카나리아 — 원래 쓰려던 값이 실제로 미달인지. 미달이 아니면 이 가드가 헛돈다. */
  it("바꾸기 전 값은 미달이었다", () => {
    expect(contrastRatio(TOKEN["--danger"], over([242, 63, 67, 0.12], CONTENT))).toBeLessThan(AA);
  });

  /** 색을 실제로 다섯 갈래로 나눴는지 — 하나로 뭉치면 위 단언은 전부 통과한다. */
  it("다섯 종이 서로 다른 색이다", () => {
    expect(new Set(CASES.map((c) => c.fg)).size).toBe(5);
  });
});
