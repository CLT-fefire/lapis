import { describe, it, expect } from "vitest";
import {
  table,
  renderResults,
  renderFacet,
  renderBroken,
  renderError,
  renderRootHelp,
  renderCommandHelp,
  renderTagPreview,
} from "./render.ts";
import { COMMANDS, GLOBAL_OPTIONS, optionsFor } from "./spec.ts";

describe("table", () => {
  it("열을 맞춘다", () => {
    const out = table([
      ["a", "1"],
      ["bbb", "2"],
    ]);
    expect(out).toBe("a    1\nbbb  2");
  });

  it("한글은 두 칸으로 센다", () => {
    // 한 칸으로 세면 한글이 섞인 표가 통째로 어긋난다.
    //
    // ⚠️ `indexOf`로 비교하면 안 된다 — 그건 **UTF-16 인덱스**라 표시 폭이 아니다.
    // "가"는 1 코드 단위인데 2칸을 차지한다. 렌더 결과를 그대로 비교한다.
    expect(
      table([
        ["가", "1"],
        ["ab", "2"],
      ]),
    ).toBe("가  1\nab  2"); // 둘 다 폭 2라 패딩이 없다

    expect(
      table([
        ["가", "1"],
        ["a", "2"],
      ]),
    ).toBe("가  1\na   2"); // "a"(1칸)는 폭 2까지 채워진다
  });

  it("줄 끝에 공백을 남기지 않는다", () => {
    const out = table([
      ["aaa", "1"],
      ["b", "2"],
    ]);
    for (const line of out.split("\n")) expect(line).toBe(line.trimEnd());
  });

  it("빈 입력은 빈 문자열", () => {
    expect(table([])).toBe("");
  });
});

describe("결과 렌더", () => {
  const row = (over: Partial<Parameters<typeof renderResults>[0][number]> = {}) => ({
    path: "/v/a.md",
    score: 1,
    rel: 1,
    doc_kind: "adr",
    title: "제목",
    snippet: null,
    ...over,
  });

  it("0건은 실패가 아니라 '결과 없음'이다", () => {
    // 종료 코드도 0이다 — 스크립트가 "없음"과 "고장"을 구분할 수 있어야 한다.
    expect(renderResults([])).toBe("결과 없음");
  });

  it("rel을 두 자리로 낸다", () => {
    expect(renderResults([row({ rel: 0.5 })])).toContain("0.50");
  });

  it("구조 전용 행(rel=null)은 —로 표시", () => {
    expect(renderResults([row({ rel: null, score: null })])).toContain("—");
  });

  it("title이 없으면 파일 이름을 쓴다", () => {
    expect(renderResults([row({ title: null })])).toContain("a.md");
  });
});

describe("facet · 끊긴 링크 렌더", () => {
  it("빈 facet", () => {
    expect(renderFacet([])).toBe("값 없음");
  });

  it("빈도와 값", () => {
    expect(renderFacet([{ value: "tech", count: 12 }])).toContain("tech");
  });

  it("끊긴 링크 없음", () => {
    expect(renderBroken([])).toBe("끊긴 링크 없음");
  });

  it("대상과 참조처를 함께 낸다", () => {
    const out = renderBroken([
      { target: "없는노트", sources: [{ path: "/v/a.md", name: "a" }] },
    ]);
    expect(out).toContain("[[없는노트]]");
    expect(out).toContain("/v/a.md");
    expect(out).toContain("1곳");
  });
});

describe("오류 렌더", () => {
  it("kind와 메시지", () => {
    expect(renderError("cache_absent", "없다")).toBe("오류(cache_absent): 없다");
  });

  it("remedy가 있으면 함께 낸다", () => {
    // 무엇이 잘못됐는지만 알려주고 어떻게 하라는 말이 없으면 절반만 전한 것이다.
    expect(renderError("cache_absent", "없다", "앱에서 vault를 한 번 열어라")).toContain("→");
  });
});

describe("도움말은 spec에서 생성된다", () => {
  it("루트 도움말에 모든 명령이 있다", () => {
    const help = renderRootHelp();
    for (const c of COMMANDS) expect(help).toContain(c.name);
  });

  it("루트 도움말에 전역 옵션이 있다", () => {
    const help = renderRootHelp();
    for (const o of GLOBAL_OPTIONS) expect(help).toContain("--" + o.name);
  });

  it("⭐ 명령별 도움말이 그 명령이 실제로 받는 옵션을 전부 낸다", () => {
    // 도움말을 손으로 쓰면 곧 실제 파서와 어긋나고, 그 어긋남은 에러가 아니라
    // **잘못된 안내**라 아무도 신고하지 않는다. 같은 배열에서 나오는지 고정한다.
    for (const c of COMMANDS) {
      const help = renderCommandHelp(c);
      for (const o of optionsFor(c)) {
        expect(help, `${c.name} 도움말에 --${o.name}이 없다`).toContain("--" + o.name);
      }
    }
  });
});

describe("태그 미리보기 렌더", () => {
  const rows = [
    { path: "/v/a.md", occurrences: 1 },
    { path: "/v/b.md", occurrences: 2 },
  ];

  it("대상이 없으면 그렇게 말한다", () => {
    expect(renderTagPreview("old", "new", [], 0, false)).toContain("쓰는 노트가 없다");
  });

  it("이전 → 새이름과 영향 범위를 낸다", () => {
    const out = renderTagPreview("tech", "stack", rows, 3, false);
    expect(out).toContain("tech  →  stack");
    expect(out).toContain("노트 2개 · 태그 3건");
  });

  it("⭐ 병합이면 되돌릴 수 없다고 경고한다", () => {
    const out = renderTagPreview("a", "b", rows, 3, true);
    expect(out).toContain("합쳐진다");
    expect(out).toContain("되돌릴 수 없다");
  });

  it("병합이 아니면 경고하지 않는다", () => {
    expect(renderTagPreview("a", "b", rows, 3, false)).not.toContain("합쳐진다");
  });
});
