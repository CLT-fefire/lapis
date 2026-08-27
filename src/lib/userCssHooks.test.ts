import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { LAPIS_HOOKS } from "./userCss";

/**
 * **`data-lapis` 훅 계약이 마크업과 맞는지** 본다.
 *
 * ## 왜 이 가드가 있나
 *
 * 훅은 사용자 정의 CSS가 붙잡는 **공개 계약**이다. 문서에는 있는데 마크업에서 사라지면
 * 남의 CSS가 **에러 없이 안 먹는다** — 앱은 멀쩡히 뜨고 그 규칙만 조용히 무시된다.
 * 사용자는 자기 CSS를 의심하지 앱을 의심하지 않는다.
 *
 * 반대 방향도 본다. 목록에 없는 `data-lapis`가 마크업에 있으면 **문서화되지 않은 계약**이
 * 생긴 것이다 — 누군가 그걸 쓰기 시작하면 우리는 그게 계약인 줄도 모르고 지운다.
 *
 * ⚠️ 컴포넌트를 전부 띄우는 대신 **소스를 읽는다.** 훅 15개를 다 보려면 vault·IPC가 다
 * 있어야 하는데, 그건 이 가드가 확인하려는 것(이름이 마크업에 박혀 있나)과 무관하다.
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));

function svelteFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) svelteFiles(p, out);
    else if (e.name.endsWith(".svelte")) out.push(p);
  }
  return out;
}

const files = svelteFiles(SRC);
const found = new Map<string, string[]>();
for (const f of files) {
  const text = readFileSync(f, "utf-8");
  for (const m of text.matchAll(/data-lapis="([a-z-]+)"/g)) {
    const name = m[1];
    if (!found.has(name)) found.set(name, []);
    found.get(name)!.push(f.slice(SRC.length).replace(/\\/g, "/"));
  }
}

/** 마크업에는 있지만 계약이 아닌 이름 — 주입되는 style 요소의 식별자. */
const NOT_A_HOOK = new Set(["user-css"]);

describe("data-lapis 훅 계약", () => {
  /** ⚠️ 카나리아 — 파일을 못 읽으면 아래가 빈 집합끼리 비교하며 통과한다. */
  it("svelte 파일과 훅을 실제로 읽었다", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(found.size).toBeGreaterThan(10);
  });

  it.each([...LAPIS_HOOKS])("`%s` 훅이 마크업에 실제로 있다", (hook) => {
    expect(
      found.get(hook),
      `계약에는 있는데 마크업에 없다 — 이 훅을 쓰는 사용자 CSS가 조용히 안 먹는다`,
    ).toBeDefined();
  });

  it("문서화되지 않은 훅이 마크업에 없다", () => {
    const undocumented = [...found.keys()].filter(
      (n) => !(LAPIS_HOOKS as readonly string[]).includes(n) && !NOT_A_HOOK.has(n),
    );
    expect(
      undocumented,
      "계약에 없는 data-lapis 가 있다. 계약이면 LAPIS_HOOKS 에 넣고, 아니면 지워라:\n  " +
        undocumented.join("\n  "),
    ).toEqual([]);
  });

  /**
   * 훅 하나가 여러 곳에 붙으면 사용자 CSS가 **의도한 것 말고도 맞힌다.**
   * `modal`은 예외다 — `ModalShell` 하나에 붙어 모든 모달이 공유한다(그게 설계다).
   */
  it("훅이 두 곳 이상에 중복되지 않는다", () => {
    const dup = [...found]
      .filter(([n, fs]) => (LAPIS_HOOKS as readonly string[]).includes(n) && fs.length > 1)
      .map(([n, fs]) => `${n}: ${fs.join(" · ")}`);
    expect(dup, "같은 훅이 여러 곳에 있다:\n  " + dup.join("\n  ")).toEqual([]);
  });
});
