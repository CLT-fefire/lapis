import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { contrastRatio } from "./colorThemes";
import { parseRootTokens } from "./previewExportDoc";

/**
 * `--danger` 는 **글자색으로 쓰지 않는다.**
 *
 * ## ⚠️ 왜 토큰을 둘로 나눴나
 *
 * `#f23f43` 은 본문 배경에서 **3.35:1** 이다(기준 4.5). 채움과 테두리에는 이 채도가 맞고
 * 글자에는 안 맞는다 — v2.1.0의 `--n-700` 과 같은 종류다.
 *
 * 콜아웃을 넣다가 브라우저에서 계산된 색을 읽어 보고 알았다. 그때 이미 **열다섯 곳**이
 * `color: var(--danger)` 를 쓰고 있었다.
 *
 * ⚠️ 이 가드가 없으면 다음에 위험 표시를 추가하는 사람이 자연스럽게 `--danger` 를 쓴다.
 * 화면은 멀쩡히 그려지고 **글자만 안 읽힌다.**
 */

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/** 주석을 지운다 — ⚠️ 안 지우면 가드가 **자기 설명을 보고** 운다. 네 번 겪었다. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

function sources(): { file: string; text: string }[] {
  const files = [
    ...globSync("**/*.css", { cwd: ROOT }),
    ...globSync("**/*.svelte", { cwd: ROOT }),
  ];
  return files.map((f) => ({
    file: f.split(path.sep).join("/"),
    text: stripComments(readFileSync(path.join(ROOT, f), "utf-8")),
  }));
}

describe("--danger 는 글자색이 아니다", () => {
  const all = sources();

  /** ⚠️ 카나리아 — 파일을 못 모았으면 아래가 빈 목록을 보고 통과한다. */
  it("소스를 실제로 모았다", () => {
    expect(all.length).toBeGreaterThan(20);
    expect(all.some((s) => s.text.includes("--danger-text"))).toBe(true);
  });

  it("`color: var(--danger)` 를 쓰는 곳이 없다", () => {
    const bad: string[] = [];
    for (const { file, text } of all) {
      // ⚠️ `border-color` · `outline-color` 는 대상이 아니다 — 글자가 아니라 선이다
      //    (비문자 대비 기준은 3:1 이고 3.35 는 통과한다).
      for (const m of text.matchAll(/(^|[^-\w])color:\s*var\(--danger\)/gm)) {
        void m;
        bad.push(file);
      }
    }
    expect(bad, `글자색으로 --danger 를 쓴다: ${[...new Set(bad)].join(", ")}`).toEqual([]);
  });

  /** 테두리로 쓰는 것은 막지 않는다 — 그게 이 토큰이 남아 있는 이유다. */
  it("테두리로는 여전히 쓴다", () => {
    const used = all.some((s) => /border-color:\s*var\(--danger\)/.test(s.text));
    expect(used, "아무도 --danger 를 안 쓰면 토큰을 지워야 한다").toBe(true);
  });
});

describe("대비", () => {
  const AA = 4.5;

  /**
   * ⚠️ 값을 여기 옮겨 적지 않는다. `app.css` 를 읽어 **실제 토큰**을 푼다 —
   * 팔레트가 바뀌면 이 가드도 같이 움직여야 한다. 처음엔 램프 단계를 손으로 적었다가
   * `--surface-content` 가 `--n-100` 인 줄 알고 틀린 면에서 재고 있었다.
   */
  const TOKENS = parseRootTokens(
    readFileSync(path.join(ROOT, "app.css"), "utf-8"),
  );

  /** `var(--x)` 사슬을 끝까지 따라간다. */
  function resolve(name: string, seen = new Set<string>()): string {
    const v = (TOKENS.get(name) ?? "").trim();
    const m = /^var\((--[\w-]+)\)$/.exec(v);
    if (!m || seen.has(name)) return v;
    seen.add(name);
    return resolve(m[1], seen);
  }

  /** 앱이 **글자를 얹는** 면들. 셋 다 봐야 한다 — 면마다 값이 다르다. */
  const SURFACES = ["--surface-content", "--surface-raised", "--surface-overlay", "--surface-rail"];

  const DANGER = resolve("--danger");
  const DANGER_TEXT = resolve("--danger-text");

  it("토큰을 실제로 풀었다", () => {
    expect(DANGER).toMatch(/^#/);
    expect(DANGER_TEXT).toMatch(/^#/);
    for (const s of SURFACES) expect(resolve(s), s).toMatch(/^#/);
  });

  for (const surface of SURFACES) {
    it(`--danger-text 가 ${surface} 에서 AA 를 넘는다`, () => {
      const r = contrastRatio(DANGER_TEXT, resolve(surface));
      expect(r, `${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
    });

  }

  /**
   * ⚠️ 카나리아 — 원래 값이 **글자를 가장 많이 얹는 면**에서 실제로 미달이어야
   * 이 분리가 뜻이 있다.
   *
   * 면 전부를 걸지 않는 이유: 3.0에서 레일이 더 어두워지면서 `--danger` 가 거기서는
   * 4.91 로 **통과**하게 됐다. "어디서나 미달"은 더는 사실이 아니고, 사실이 아닌 것을
   * 가드에 적어 두면 다음에 팔레트를 만질 때 그 가드를 지우게 된다.
   */
  it("--danger 는 본문 면에서 AA 미달이다", () => {
    const r = contrastRatio(DANGER, resolve("--surface-content"));
    expect(r, `${r.toFixed(2)}:1`).toBeLessThan(AA);
  });
});
