import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 🔴 **닫기 버튼의 이름이 기호면 보조기술이 기호를 읽는다.**
 *
 * `aria-label="✕"` 는 라벨을 **붙인 것처럼 보이지만** 실제로는 "✕" 라고 읽힌다.
 * 라벨이 아예 없는 것보다 나쁠 수 있다 — 없으면 도구가 "버튼"이라고라도 말하지만,
 * 있으면 그 값을 그대로 읽는다. 그리고 검사 도구는 "라벨 있음"으로 통과시킨다.
 *
 * 세 모달(`GrepModal` · `TagRenameModal` · `VaultHygieneModal`)이 그 상태였고,
 * 같은 앱의 다른 모달들은 `m.settings_close()` 처럼 제대로 된 이름을 쓰고 있었다 —
 * **같은 규칙이 파일마다 다르게 적힌** 익숙한 모양이다. 프리뷰에서 모달의 버튼 속성을
 * 훑다 걸렸다.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const LIB = join(ROOT, "src/lib");

/** 이름으로 쓸 수 없는 것 — 글자·숫자가 하나도 없으면 기호다. */
const SYMBOL_ONLY = /^[^\p{L}\p{N}]+$/u;

describe("모달 닫기 버튼의 이름", () => {
  const files = readdirSync(LIB).filter((f) => f.endsWith(".svelte"));

  it("기호를 접근 가능한 이름으로 쓰지 않는다", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(LIB, f), "utf-8");
      // `aria-label="…"` 의 리터럴 값만 본다. `{m.foo()}` 형태는 대상이 아니다.
      for (const m of src.matchAll(/aria-label="([^"]*)"/g)) {
        const value = m[1].trim();
        if (value !== "" && SYMBOL_ONLY.test(value)) {
          offenders.push(`${f}: aria-label="${value}"`);
        }
      }
    }
    expect(
      offenders,
      `보조기술이 기호를 읽는다. 번역된 "닫기" 를 쓴다:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
