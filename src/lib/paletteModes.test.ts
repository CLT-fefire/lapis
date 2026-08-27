import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CYCLE_MODES,
  cycleMode,
  parseInput,
  relScore,
  folderChips,
  type PaletteMode,
  type PaletteResult,
} from "./palette";

/**
 * 팔레트 **모드**를 1급으로 만든 뒤의 규칙들.
 *
 * v2 까지 모드는 두 곳에서 나왔다 — 단축키가 주는 힌트(`files`·`fulltext`)와 입력
 * 접두사(`>`·`#`·`:`). 3.0 은 여기에 `⇥` 순환을 더한다. 세 입구가 **같은 상태**를
 * 가리키지 않으면 "탭을 눌렀는데 아무 일도 안 일어난다"가 된다 — 에러 없이.
 */

describe("모드 순환", () => {
  it("순환은 넷이다 — 전체 · 파일 · 전문 · 명령", () => {
    expect([...CYCLE_MODES]).toEqual(["all", "files", "fulltext", "command"]);
  });

  it("앞으로 돌면 끝에서 처음으로 돌아온다", () => {
    let m: PaletteMode = "all";
    const seen: PaletteMode[] = [];
    for (let i = 0; i < 5; i++) {
      m = cycleMode(m, 1);
      seen.push(m);
    }
    expect(seen).toEqual(["files", "fulltext", "command", "all", "files"]);
  });

  it("뒤로도 돈다", () => {
    expect(cycleMode("all", -1)).toBe("command");
    expect(cycleMode("files", -1)).toBe("all");
  });

  /**
   * ⚠️ `tag`·`facet` 은 순환에 없다 — 접두사로만 들어간다. 순환 밖의 모드에서 `⇥` 를
   * 누르면 "전체에 있었던 것처럼" 움직인다. 여기서 그대로 두면 `⇥` 가 죽은 키가 되고,
   * 죽은 키는 고장과 구별이 안 된다.
   */
  it("순환 밖 모드에서도 죽지 않는다", () => {
    expect(cycleMode("tag", 1)).toBe("files");
    expect(cycleMode("facet", 1)).toBe("files");
    expect(cycleMode("tag", -1)).toBe("command");
  });
});

describe("parseInput — 명령 모드 힌트", () => {
  /**
   * ⚠️ 이게 없으면 `⇥` 로 명령 모드에 가도 `parseInput` 이 `all` 을 내고 **아무 일도
   * 안 일어난다.** `files`·`fulltext` 는 이미 힌트를 존중하고 있었다.
   */
  it("힌트가 command 면 접두사 없이도 명령 모드다", () => {
    expect(parseInput("open", "command")).toEqual({ mode: "command", query: "open" });
  });

  it("명령 모드에서 사용자가 `>` 를 또 쳐도 질의에 안 남는다", () => {
    expect(parseInput("> open", "command")).toEqual({ mode: "command", query: "open" });
  });

  it("힌트가 all 이면 접두사가 모드를 정한다", () => {
    expect(parseInput(">x", "all")).toEqual({ mode: "command", query: "x" });
    expect(parseInput("#x", "all")).toEqual({ mode: "tag", query: "x" });
    expect(parseInput(":x", "all")).toEqual({ mode: "facet", query: "x" });
    expect(parseInput("x", "all")).toEqual({ mode: "all", query: "x" });
  });

  /** 파일·전문 모드는 접두사를 **무시**한다 — 그 모드로 연 이유가 있어서다. */
  it("파일·전문 모드는 접두사를 글자로 본다", () => {
    expect(parseInput("#tag", "files")).toEqual({ mode: "files", query: "#tag" });
    expect(parseInput(">run", "fulltext")).toEqual({ mode: "fulltext", query: ">run" });
  });
});

describe("rel — 질의 내 상대 점수", () => {
  /** MCP 의 `ResultRow.rel` 과 같은 뜻이다: top-1 이 1.0 인 `[0,1]`. */
  it("top-1 은 1.0", () => {
    expect(relScore(1200, 1200)).toBe(1);
  });

  it("비율 그대로", () => {
    expect(relScore(600, 1200)).toBe(0.5);
  });

  /** ⚠️ 0 으로 나누면 NaN 이 화면에 나온다 — 숫자가 아닌 것은 숫자보다 나쁘다. */
  it("top 이 0 이어도 NaN 을 안 낸다", () => {
    expect(relScore(0, 0)).toBe(0);
  });

  it("음수 점수는 0 으로 바닥을 친다", () => {
    expect(relScore(-5, 100)).toBe(0);
  });
});

function content(path: string, score: number): PaletteResult {
  return {
    entry: { kind: "content", path, name: path.split("/").pop() ?? path, snippet: "" },
    score,
  };
}

describe("폴더 칩", () => {
  it("본문 결과의 부모 디렉터리를 개수와 함께 낸다", () => {
    const chips = folderChips([
      content("a/b/one.md", 10),
      content("a/b/two.md", 9),
      content("a/three.md", 8),
    ]);
    expect(chips).toEqual([
      { path: "a/b", count: 2 },
      { path: "a", count: 1 },
    ]);
  });

  /** 루트 파일은 빈 경로다 — 버리면 결과 수와 칩 합계가 안 맞는다. */
  it("루트 파일도 칩이 된다", () => {
    expect(folderChips([content("top.md", 5)])).toEqual([{ path: "", count: 1 }]);
  });

  /** 개수가 같으면 경로순 — 안 그러면 같은 질의가 매번 다른 순서를 낸다. */
  it("동점은 경로순으로 갈린다", () => {
    const chips = folderChips([content("z/1.md", 5), content("a/1.md", 5)]);
    expect(chips.map((c) => c.path)).toEqual(["a", "z"]);
  });

  it("개수가 많은 폴더가 앞", () => {
    const chips = folderChips([content("z/1.md", 5), content("z/2.md", 4), content("a/1.md", 5)]);
    expect(chips.map((c) => c.path)).toEqual(["z", "a"]);
  });

  /**
   * ⚠️ **본문 결과에서만** 뽑는다. 최근·바뀐 그룹도 경로를 들고 있고 전문 모드에서도
   * 보이지만, 그것들은 질의가 찾아낸 것이 아니다 — 섞으면 칩이 질의와 무관해진다.
   */
  it("본문이 아닌 결과는 안 센다", () => {
    const chips = folderChips([
      content("a/hit.md", 10),
      { entry: { kind: "recent", path: "z/opened.md", label: "opened" }, score: 1 },
      { entry: { kind: "note", path: "z/named.md", label: "named" }, score: 1 },
    ]);
    expect(chips).toEqual([{ path: "a", count: 1 }]);
  });

  it("상한을 넘으면 자른다", () => {
    const many = Array.from({ length: 12 }, (_, i) => content(`d${i}/x.md`, 12 - i));
    expect(folderChips(many, 6)).toHaveLength(6);
  });
});

/**
 * ⚠️ **배선 가드.** 위 순수 함수들이 전부 초록이어도 `CommandPalette.svelte` 가 그것을
 * 안 부르면 화면은 v2 그대로다 — 에러 없이. 이 세션에서 실제로 여러 번 겪은 실패다.
 *
 * ⚠️ 주석을 먼저 지운다. 안 그러면 **가드가 자기 설명 문구에 맞아** 통과한다.
 */
describe("팔레트 컴포넌트 배선", () => {
  const src = (() => {
    const raw = readFileSync(
      fileURLToPath(new URL("./CommandPalette.svelte", import.meta.url)),
      "utf-8",
    );
    return raw
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  })();

  it("Tab 이 모드를 돌린다", () => {
    expect(src).toMatch(/e\.key === "Tab"/);
    expect(src).toMatch(/cycleMode\(/);
  });

  /** v2 에서 Tab 은 ArrowDown 의 별칭이었다. 남아 있으면 순환이 절대 안 돈다. */
  it("Tab 이 더 이상 목록 이동이 아니다", () => {
    expect(src).not.toMatch(/e\.key === "Tab" && !e\.shiftKey/);
    expect(src).not.toMatch(/ArrowDown" \|\| \(e\.key === "Tab"/);
  });

  it("모드 넷을 칩으로 그린다", () => {
    expect(src).toMatch(/#each CYCLE_MODES as mode/);
  });

  it("전문 결과에 rel 을 낸다", () => {
    expect(src).toMatch(/relScore\(/);
  });

  it("폴더 칩을 그린다", () => {
    expect(src).toMatch(/folderChips\(/);
    expect(src).toMatch(/#each chips as/);
  });

  /**
   * stagger 는 `data-idx` 로 자리를 잡는다. `:nth-child` 로 바꾸면 그룹 헤더까지 세어
   * **화면의 몇 번째 행인지와 어긋난다** — 어긋나도 애니메이션은 돌아서 안 보인다.
   */
  it("앞 여덟 행에만 지연이 붙는다", () => {
    const delays = [...src.matchAll(/\.result\[data-idx="(\d+)"\]/g)].map((m) => Number(m[1]));
    expect(delays).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  /** 푸터에 안 적힌 키는 없는 키다. */
  it("푸터가 ⇥ 를 안내한다", () => {
    expect(src).toMatch(/palette_key_mode\(\)/);
  });
});
