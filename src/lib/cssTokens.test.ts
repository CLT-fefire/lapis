import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * `var(--x)`로 쓰인 CSS 토큰이 **전부 정의돼 있는지** 고정한다.
 *
 * ## 왜 이 테스트가 있나
 *
 * 정의되지 않은 커스텀 프로퍼티는 **에러가 아니다.** 선언이 통째로 무시될 뿐이라
 * 빌드도 통과하고 `svelte-check`도 통과한다. 증상은 "hover가 안 먹는다" 같은 모습으로만
 * 나타나고, 그마저도 눈에 안 띄면 그냥 남는다.
 *
 * 실제로 `TableView.svelte`가 `--surface-hover`(4곳) · `--accent-soft`(1곳) ·
 * `--text-tertiary`(6곳)를 쓰고 있었는데 셋 다 `app.css`에 없었다. hover 배경과
 * 선택 강조가 **아무 일도 하지 않는 상태로** 머지됐다.
 *
 * `app.css`가 "디자인 토큰의 단일 출처"라면, 그 밖의 이름을 쓰는 건 오타이거나
 * 있어야 할 토큰을 안 만든 것이다. 둘 다 여기서 걸린다.
 */

/**
 * 정적 정의가 없는 게 **정상**인 토큰 — 런타임에 인라인 style로 주입된다.
 *
 * ⚠️ 여기 추가할 때는 "정말 런타임 주입인가"를 확인할 것. 오타를 덮는 데 쓰면
 * 이 테스트가 존재할 이유가 사라진다.
 */
const RUNTIME_INJECTED = new Set([
  "--sidebar-w", // +page.svelte가 드래그 폭을 인라인으로
  "--context-w", // 같은 이유
  "--reading-font-size", // ReadingControls가 measure를 인라인으로
]);

/** `var(--x)`가 문자열 조합으로 만들어지는 곳 — 정적 스캔으로 판정할 수 없다. */
const DYNAMIC_PREFIXES = ["--cm-"];

function collect(dir: string, out: Map<string, Set<string>>): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "paraglide") collect(p, out);
      continue;
    }
    // 테스트 파일은 제외 — 픽스처가 가짜 토큰(`--a`, `--nope`)을 일부러 쓴다.
    if (!/\.(svelte|css)$/.test(e.name)) continue;
    const text = readFileSync(p, "utf8");
    for (const m of text.matchAll(/var\((--[a-z0-9-]+)/g)) {
      const key = m[1];
      if (!out.has(key)) out.set(key, new Set());
      out.get(key)!.add(p.split(path.sep).join("/"));
    }
  }
}

describe("CSS 토큰", () => {
  it("var()로 쓰인 토큰은 모두 app.css에 정의돼 있다", () => {
    const css = readFileSync("src/app.css", "utf8");
    const defined = new Set(
      [...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
    );

    const used = new Map<string, Set<string>>();
    collect("src", used);

    const missing = [...used.entries()]
      .filter(([k]) => !defined.has(k))
      .filter(([k]) => !RUNTIME_INJECTED.has(k))
      .filter(([k]) => !DYNAMIC_PREFIXES.some((p) => k.startsWith(p)))
      .map(([k, files]) => `${k} (${[...files].join(", ")})`);

    // 실패 메시지에 어느 파일인지까지 담는다 — 토큰 이름만으로는 못 찾는다.
    expect(missing).toEqual([]);
  });

  it("app.css는 자기 토큰을 실제로 정의한다 — 스캐너 자체의 회귀 방지", () => {
    const css = readFileSync("src/app.css", "utf8");
    const defined = new Set(
      [...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
    );
    // 위 정규식이 깨지면 `missing`이 비어 첫 테스트가 무의미하게 통과한다.
    expect(defined.has("--surface-base")).toBe(true);
    expect(defined.has("--text-primary")).toBe(true);
    expect(defined.size).toBeGreaterThan(50);
  });
});
