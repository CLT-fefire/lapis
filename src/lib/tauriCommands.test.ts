import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * 프런트엔드가 부르는 `invoke("x")`가 **Rust에 실제로 등록돼 있는지** 고정한다.
 *
 * ## 왜 이 테스트가 있나
 *
 * 커맨드 이름은 **문자열**이라 타입 검사가 닿지 않는다. `svelte-check`도 `tsc`도
 * `cargo`도 통과하고, 오타나 제거된 커맨드는 **그 기능을 실제로 쓰는 순간에만**
 * 런타임 에러로 터진다. 잘 안 쓰는 경로면 영영 안 터질 수도 있다.
 *
 * 실제로 `writeSearchCache`가 그랬다. 샤딩 이전(캐시 v3) 저장 함수였는데 Rust 쪽
 * 커맨드는 v4에서 사라지고 TS 래퍼만 남아, **부르면 "command not found"로 죽는
 * 함수가 API처럼 보이는 채로** 남아 있었다.
 *
 * ## 반대 방향은 검사하지 않는다
 *
 * "등록됐는데 아무도 안 부르는 커맨드"는 죽은 코드일 뿐 **고장이 아니다.** 여기서
 * 막으려는 건 부르면 깨지는 쪽 하나다.
 */

/** `generate_handler![...]` 안의 항목에서 커맨드 이름만 뽑는다(`vault::list_notes` → `list_notes`). */
function registeredCommands(): Set<string> {
  const rs = readFileSync("src-tauri/src/lib.rs", "utf8");
  const m = /generate_handler!\[([\s\S]*?)\]/.exec(rs);
  if (!m) throw new Error("lib.rs에서 generate_handler! 블록을 찾지 못했다");
  return new Set(
    m[1]
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => x.split("::").pop()!),
  );
}

/** 소스에서 `invoke("x")` / `invoke<T>("x")`의 x를 파일과 함께 모은다. */
function invokedCommands(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "paraglide") walk(p);
        continue;
      }
      if (!/\.(ts|svelte)$/.test(e.name) || /\.test\.ts$/.test(e.name)) continue;
      const text = readFileSync(p, "utf8");
      for (const m of text.matchAll(/\binvoke\s*(?:<[^>]*>)?\s*\(\s*"([a-z0-9_]+)"/g)) {
        if (!out.has(m[1])) out.set(m[1], new Set());
        out.get(m[1])!.add(p.split(path.sep).join("/"));
      }
    }
  };
  walk("src");
  return out;
}

describe("Tauri 커맨드 계약", () => {
  it("invoke로 부르는 커맨드는 모두 lib.rs에 등록돼 있다", () => {
    const registered = registeredCommands();
    const missing = [...invokedCommands().entries()]
      .filter(([name]) => !registered.has(name))
      // 실패 메시지에 파일까지 담는다 — 이름만으로는 어디서 부르는지 못 찾는다.
      .map(([name, files]) => `${name} (${[...files].join(", ")})`);

    expect(missing).toEqual([]);
  });

  it("스캐너가 실제로 뭔가를 찾는다 — 정규식 회귀 방지", () => {
    // 두 스캐너 중 하나가 조용히 빈 집합을 내면 위 테스트가 무의미하게 통과한다.
    const registered = registeredCommands();
    const invoked = invokedCommands();
    expect(registered.size).toBeGreaterThan(20);
    expect(invoked.size).toBeGreaterThan(20);
    expect(registered.has("read_note")).toBe(true);
    expect(invoked.has("read_note")).toBe(true);
  });
});
