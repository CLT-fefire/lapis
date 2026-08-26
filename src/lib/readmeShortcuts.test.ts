import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolveShortcut, type KeyChord } from "./keymap";

/**
 * `README.md`의 단축키 표가 **실제로 동작하는지** 본다.
 *
 * ## 왜 이 가드가 있나
 *
 * 표가 셋 어긋난 채로 오래 있었다 — `⌥B`(실제 `⌘⌥B`), `⌘←`/`⌘→`(실제 `⌘⌃←`/`⌘⌃→`),
 * 그리고 `⌘⇧B`가 표에 아예 없었다.
 *
 * 이게 조용히 틀리는 부류인 이유: **양쪽 다 혼자서는 옳다.** 코드는 잘 돌고
 * (`keymap.test.ts`가 고정한다), 문서도 문법적으로 멀쩡하다. 어긋난 것은 둘 사이다.
 * 그래서 사용자에게는 코드도 문서도 아니라 **"앱이 고장났다"** 로 보인다 — 적힌 대로
 * 눌러도 아무 일이 없으니까.
 *
 * ⚠️ 여기서 보는 것은 **"눌렀을 때 뭐라도 일어나나"** 다. 어느 동작으로 가는지는
 * `keymap.test.ts`가 본다. 라벨 문구까지 대조하면 README 영어와 `ShortcutId`를 손으로
 * 이어야 해서 가드가 스스로 어긋난다.
 */

const README = readFileSync(new URL("../../README.md", import.meta.url), "utf-8");

/** 글리프 → KeyChord 조각. `⌘`는 Windows에서 Ctrl로도 받지만 매칭은 meta로 충분하다. */
const MODIFIERS: Record<string, keyof KeyChord> = {
  "⌘": "metaKey", // ⌘
  "⇧": "shiftKey", // ⇧
  "⌥": "altKey", // ⌥
  "⌃": "ctrlKey", // ⌃
};

/** 글리프로 오는 키 이름. 나머지는 소문자 한 글자 그대로 쓴다. */
const NAMED_KEYS: Record<string, string> = {
  "⌫": "Backspace", // ⌫
  "←": "ArrowLeft", // ←
  "→": "ArrowRight", // →
};

function parseChord(spec: string): KeyChord | null {
  const chord: KeyChord = {
    key: "",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };
  let rest = spec;
  for (;;) {
    const mod = MODIFIERS[rest[0]];
    if (!mod) break;
    (chord[mod] as boolean) = true;
    rest = rest.slice(1);
  }
  if (!rest) return null;
  chord.key = NAMED_KEYS[rest] ?? (rest.length === 1 ? rest.toLowerCase() : rest);
  return chord;
}

/**
 * 표에서 단축키 문자열을 뽑는다.
 *
 * 한 셀에 여럿이 올 수 있다 — `` `⌘⇧F` · `⌘⇧P` `` 처럼. 범위 표기
 * (`` `⌘1`–`⌘9` ``)는 양 끝만 본다: 가운데는 같은 분기라 새로 검증할 것이 없다.
 */
function shortcutsFromTable(): string[] {
  const rows = README.split("\n").filter((l) => /^\|\s*`/.test(l));
  const specs: string[] = [];
  for (const row of rows) {
    const cell = row.split("|")[1] ?? "";
    for (const m of cell.matchAll(/`([^`]+)`/g)) specs.push(m[1]);
  }
  return specs;
}

/** 매칭 대상이 아닌 것 — 여기 있어도 정상이다. */
const NOT_A_CHORD = new Set([
  "Fn+F2", // 안내 문장에 나오는 하드웨어 조합
]);

describe("README 단축키 표", () => {
  const specs = shortcutsFromTable();

  /**
   * ⚠️ **카나리아.** 표 형식이 바뀌거나 정규식이 깨지면 `specs`가 비고, 아래 테스트는
   * 빈 목록을 돌며 **조용히 통과한다.** 실패할 수 없는 가드는 가드가 아니다.
   */
  it("표에서 단축키를 실제로 뽑았다", () => {
    expect(specs.length).toBeGreaterThan(15);
    // 형태가 맞는지도 본다 — 엉뚱한 인라인 코드를 긁어모으고 있으면 여기서 걸린다.
    expect(specs).toContain("⌘K");
    expect(specs).toContain("⌘⌥B");
  });

  it.each(specs.filter((s) => !NOT_A_CHORD.has(s)))("`%s` 를 누르면 무언가 일어난다", (spec) => {
    const chord = parseChord(spec);
    expect(chord, `단축키 표기를 읽지 못했다: ${spec}`).not.toBeNull();
    expect(
      resolveShortcut(chord!, { inEditing: false }),
      `README에 있는데 keymap이 안 잡는다: ${spec}`,
    ).not.toBeNull();
  });

  /**
   * 반대 방향 — 코드에는 있는데 표에 없는 것. `⌘⇧B`가 정확히 이 경우였다.
   *
   * 전량 대조는 안 한다(`⌘1`–`⌘9`의 가운데처럼 일부러 안 적는 것이 있다).
   * 표에서 빠진 적이 있는 것만 고정한다 — 한 번 빠진 자리는 다시 빠진다.
   */
  it.each([
    ["⌘⇧B", "table-view"],
    ["⌘⌥B", "toggle-context"],
    ["⌘⌃←", "nav-back"],
  ])("`%s` 가 표에 적혀 있다", (spec) => {
    expect(specs).toContain(spec);
  });
});
