import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 🔴 **번역을 빠뜨리면 한국어 화면에 영어가 섞인다 — 에러 없이.**
 *
 * 실측으로 걸린 셋:
 * - `NewNoteModal` 의 주 버튼이 `Create & Open` 이었다. 바로 옆 "취소"는 `m.newnote_cancel()`.
 * - 팔레트 그룹 헤더 아홉 중 `COMMANDS` 하나만 하드코딩이었다. 형제들은 "최근" · "노트" ·
 *   "본문" 로 나온다.
 * - `commandsHeaderLabel` 이 `"COMMANDS"` / `"QUICK ACTIONS"` 를 그대로 들고 있었다.
 *
 * 셋 다 프리뷰에서 화면을 읽다 걸렸다. 타입 검사도 테스트도 못 잡는다 — 문자열은
 * **문법적으로 멀쩡**하기 때문이다.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * 영어처럼 보여도 번역 대상이 아닌 것.
 *
 * ⚠️ **이 목록이 자라기 시작하면 판정이 틀렸다는 신호다**, 목록이 짧다는 신호가 아니다.
 * 고유명사 · 약어 · 기술 라벨만 들어간다.
 */
const NOT_UI_TEXT = new Set([
  "Aa", // 글꼴 크기 버튼 — 만국 공통 표기
  "DEBUG",
  "FIXTURE", // dev 전용 배지. 번역하면 오히려 못 알아본다
  "CSV",
  "JSON",
  "MCP",
  "CLI",
  "URL",
  "BM25",
  "Lapis",
  "Markdown",
  "Mermaid",
  "GitHub",
]);

function svelteFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) svelteFiles(p, out);
    else if (e.name.endsWith(".svelte")) out.push(p);
  }
  return out;
}

/** 주석과 `<style>` 은 화면에 안 나온다 — 검사에서 뺀다. */
function strip(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("화면 문자열은 번역을 거친다", () => {
  const files = [
    ...svelteFiles(join(ROOT, "src/lib")),
    ...svelteFiles(join(ROOT, "src/routes")),
  ];

  /** 태그 사이에 그대로 적힌 영어 — `>Create & Open<` 같은 것. */
  it("마크업에 영어 문장을 직접 적지 않는다", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const body = strip(readFileSync(f, "utf-8"));
      for (const m of body.matchAll(/>\s*([A-Z][A-Za-z][A-Za-z &;]{2,40}?)\s*</g)) {
        const text = m[1].replace(/&amp;/g, "&").trim();
        if (NOT_UI_TEXT.has(text)) continue;
        offenders.push(`${f.replace(ROOT, "")}: "${text}"`);
      }
    }
    expect(
      offenders,
      `한국어 화면에 영어가 섞인다. messages/ 에 키를 두고 m.…() 를 쓴다:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  /**
   * 표시용 값을 코드에서 만드는 경우 — `$derived(x ? "COMMANDS" : "QUICK ACTIONS")`.
   *
   * ⚠️ 마크업 검사만으로는 이게 안 잡힌다. 실제로 `commandsHeaderLabel` 이 그렇게 새 나갔다.
   */
  it("전부 대문자인 영어 리터럴을 라벨로 쓰지 않는다", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const body = strip(readFileSync(f, "utf-8"));
      for (const m of body.matchAll(/(.{0,14})["']([A-Z][A-Z ]{3,30})["']/g)) {
        const [, before, raw] = m;
        const text = raw.trim();
        if (NOT_UI_TEXT.has(text)) continue;
        // ⚠️ **비교 대상은 라벨이 아니다.** `target.tagName === "INPUT"` 을 번역하라고
        //    하면 가드가 틀린 말을 하기 시작하고, 그러면 아무도 안 믿는다.
        if (/[=!]==?\s*$|(?:includes|has|startsWith|endsWith)\(\s*$/.test(before)) continue;
        offenders.push(`${f.replace(ROOT, "")}: "${text}"`);
      }
    }
    expect(
      offenders,
      `코드가 만든 라벨도 번역을 거쳐야 한다:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});

/**
 * ⚠️ **두 로케일의 키가 같아야 한다.** 한쪽에만 있는 키는 다른 로케일에서 조용히
 * 빈 문자열이나 키 이름으로 새어 나온다.
 */
describe("로케일 키가 짝이 맞는다", () => {
  it("ko 와 en 의 키 집합이 같다", () => {
    const read = (l: string) =>
      Object.keys(JSON.parse(readFileSync(join(ROOT, `messages/${l}.json`), "utf-8")));
    const ko = new Set(read("ko"));
    const en = new Set(read("en"));
    expect([...ko].filter((k) => !en.has(k)), "en 에 없는 키").toEqual([]);
    expect([...en].filter((k) => !ko.has(k)), "ko 에 없는 키").toEqual([]);
  });
});
