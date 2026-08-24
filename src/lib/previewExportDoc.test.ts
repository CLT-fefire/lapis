import { describe, expect, it } from "vitest";
import {
  EXPORT_BASE_CSS,
  buildHtmlDocument,
  buildRootTokenBlock,
  collectCssVarNames,
  documentTitle,
  escapeHtml,
  suggestHtmlFileName,
} from "./previewExportDoc";
import { readFileSync } from "node:fs";

// ⚠️ `import css from "...css?raw"` 는 **vitest에서 빈 문자열**이 된다(CSS 임포트를 stub).
//    앱 번들(previewExport.ts)에서는 정상이므로 앱 버그가 아니라 테스트 환경 제약 —
//    여기서는 실제 배포되는 파일을 파일시스템에서 그대로 읽어 검증한다.
const renderedCss = readFileSync(
  new URL("./styles/rendered.css", import.meta.url),
  "utf-8",
);

describe("collectCssVarNames", () => {
  it("var() 참조에서 토큰 이름을 뽑는다", () => {
    const css = ".a { color: var(--accent); background: var(--surface-sunken); }";
    expect(collectCssVarNames(css)).toEqual(["--accent", "--surface-sunken"]);
  });

  it("fallback이 붙은 var()도 이름만 뽑는다", () => {
    expect(collectCssVarNames("font-size: var(--reading-font-size, 15px);"))
      .toEqual(["--reading-font-size"]);
  });

  it("var( 뒤 공백을 허용한다", () => {
    expect(collectCssVarNames("color: var( --accent );")).toEqual(["--accent"]);
  });

  it("var()가 아닌 곳의 -- 는 잡지 않는다", () => {
    expect(collectCssVarNames("--accent: #fff; /* -- 주석 */")).toEqual([]);
  });
});

describe("buildRootTokenBlock", () => {
  it("쓰인 토큰만 해석해 :root 블록을 만든다", () => {
    const css = "a { color: var(--accent); }";
    const block = buildRootTokenBlock(css, (n) =>
      ({ "--accent": "#5cc8ff", "--unused": "#000" })[n] ?? "");
    expect(block).toBe(":root {\n  --accent: #5cc8ff;\n}");
    expect(block).not.toContain("--unused");
  });

  it("값이 또 var()를 참조하면 따라가 확장한다", () => {
    // app.css의 `--surface-base: var(--n-50)` 같은 간접 정의 대비.
    const table: Record<string, string> = {
      "--surface-base": "var(--n-50)",
      "--n-50": "#0f1115",
    };
    const block = buildRootTokenBlock("body { background: var(--surface-base); }",
      (n) => table[n] ?? "");
    expect(block).toContain("--surface-base: var(--n-50);");
    expect(block).toContain("--n-50: #0f1115;");
  });

  it("순환 참조에서 무한 루프에 빠지지 않는다", () => {
    const table: Record<string, string> = { "--a": "var(--b)", "--b": "var(--a)" };
    const block = buildRootTokenBlock("x { y: var(--a); }", (n) => table[n] ?? "");
    expect(block).toContain("--a: var(--b);");
    expect(block).toContain("--b: var(--a);");
  });

  it("미정의 토큰은 선언을 생략해 CSS의 fallback이 살아남게 한다", () => {
    const block = buildRootTokenBlock("p { font-size: var(--nope, 15px); }", () => "");
    expect(block).toBe(":root {\n\n}");
    expect(block).not.toContain("--nope");
  });

  it("같은 입력이면 항상 같은 출력 (정렬 — 재내보내기 diff 안정)", () => {
    const css = "a{color:var(--z)}b{color:var(--a)}c{color:var(--m)}";
    const resolve = (n: string) => `v${n}`;
    const first = buildRootTokenBlock(css, resolve);
    expect(first).toBe(buildRootTokenBlock(css, resolve));
    // 등장 순서(z, a, m)가 아니라 정렬 순서(a, m, z)
    expect(first.indexOf("--a:")).toBeLessThan(first.indexOf("--m:"));
    expect(first.indexOf("--m:")).toBeLessThan(first.indexOf("--z:"));
  });

  it("토큰이 중복 등장해도 한 번만 선언한다", () => {
    const block = buildRootTokenBlock("a{c:var(--x)}b{c:var(--x)}", () => "#fff");
    expect(block.match(/--x:/g)).toHaveLength(1);
  });
});

describe("suggestHtmlFileName / documentTitle", () => {
  it("경로에서 stem을 뽑아 .html을 붙인다", () => {
    expect(suggestHtmlFileName("/a/b/노트 제목.md")).toBe("노트 제목.html");
    expect(documentTitle("/a/b/노트 제목.md")).toBe("노트 제목");
  });

  it(".mmd / .markdown 확장자도 벗긴다", () => {
    expect(suggestHtmlFileName("/a/diagram.mmd")).toBe("diagram.html");
    expect(suggestHtmlFileName("/a/doc.markdown")).toBe("doc.html");
  });

  it("확장자 대소문자를 가리지 않는다", () => {
    expect(suggestHtmlFileName("/a/README.MD")).toBe("README.html");
  });

  it("경로가 없으면 기본값으로 떨어진다", () => {
    expect(suggestHtmlFileName(null)).toBe("note.html");
    expect(suggestHtmlFileName(undefined)).toBe("note.html");
    expect(suggestHtmlFileName("")).toBe("note.html");
  });

  it("파일명이 확장자뿐이어도 기본값으로 떨어진다", () => {
    expect(suggestHtmlFileName("/a/.md")).toBe("note.html");
  });

  it("중간의 .md 는 건드리지 않는다 (끝만 벗긴다)", () => {
    expect(suggestHtmlFileName("/a/v1.md.backup.md")).toBe("v1.md.backup.html");
  });
});

describe("escapeHtml", () => {
  it("title 주입을 막는다", () => {
    expect(escapeHtml(`<script>"&`)).toBe("&lt;script&gt;&quot;&amp;");
  });

  it("& 를 먼저 치환해 이중 이스케이프하지 않는다", () => {
    expect(escapeHtml("a & <b>")).toBe("a &amp; &lt;b&gt;");
  });
});

describe("buildHtmlDocument", () => {
  const parts = {
    title: "테스트 & <노트>",
    tokenBlock: ":root {\n  --accent: #5cc8ff;\n}",
    renderedCss: ".rendered h1 { color: var(--accent); }",
    bodyHtml: "<h1>안녕</h1>",
  };

  it("외부 참조 없는 완결 문서를 만든다", () => {
    const html = buildHtmlDocument(parts);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<article class="rendered">');
    expect(html).toContain("<h1>안녕</h1>");
    // 외부 리소스를 부르는 태그가 없어야 자립이 성립한다
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/<script\b/);
  });

  it("title을 이스케이프한다", () => {
    expect(buildHtmlDocument(parts)).toContain(
      "<title>테스트 &amp; &lt;노트&gt;</title>",
    );
  });

  it("토큰 블록이 rendered.css보다 먼저 온다 (해석 순서 무관하지만 가독성)", () => {
    const html = buildHtmlDocument(parts);
    expect(html.indexOf("--accent: #5cc8ff")).toBeLessThan(
      html.indexOf(".rendered h1"),
    );
  });
});

/* 본문 폭(measure)이 내보낸 문서까지 따라가는 경로를 못박는다. 2026-08-06 이전에는
   EXPORT_BASE_CSS가 `max-width: 900px`를 따로 갖고 있어 앱과 내보내기가 서로 다른 폭을
   썼다(앱은 무제한 = 더 나쁨). 폭 규칙의 단일 진실은 rendered.css다. */
describe("본문 폭(--reading-measure) 내보내기 경로", () => {
  it("rendered.css가 --reading-measure를 참조한다", () => {
    expect(collectCssVarNames(renderedCss)).toContain("--reading-measure");
  });

  it("EXPORT_BASE_CSS는 폭 규칙을 갖지 않는다 (rendered.css와 이중화 금지)", () => {
    expect(EXPORT_BASE_CSS).not.toContain("max-width");
  });

  it("article에서 읽은 폭 값이 토큰 블록에 실린다", () => {
    // previewExport.ts는 :root가 아니라 **article**의 computed style로 해석한다 —
    // 사용자가 설정에서 폭 제한을 끄면 그 인라인 값(none)이 그대로 내보내기에 반영된다.
    const css = `${EXPORT_BASE_CSS}\n${renderedCss}`;
    const on = buildRootTokenBlock(css, (n) =>
      n === "--reading-measure" ? "38em" : "",
    );
    expect(on).toContain("--reading-measure: 38em;");

    const off = buildRootTokenBlock(css, (n) =>
      n === "--reading-measure" ? "none" : "",
    );
    expect(off).toContain("--reading-measure: none;");
  });
});

/* 표가 가로로 터지던 증상의 한 줄 고침(2026-08-24)을 못박는다. 인라인 코드에 줄바꿈
   허용이 없으면 공백 없는 긴 경로가 그 열의 min-content를 키우고, 자동 레이아웃인 표는
   폭을 잃은 다른 열을 한 글자씩 접는다. 규칙은 `rendered.css` 한 곳에만 두고 내보내기가
   그 원문을 그대로 싣는 구조라, **규칙의 존재**와 **내보내기 도달**을 함께 고정한다. */
describe("인라인 코드 줄바꿈 (표 폭 회귀 방지)", () => {
  const RULE =
    /\.rendered\s+:not\(pre\)\s*>\s*code\s*\{[^}]*overflow-wrap:\s*anywhere/;

  it("인라인 코드에 overflow-wrap: anywhere 가 걸려 있다", () => {
    expect(renderedCss).toMatch(RULE);
  });

  it("코드블록(pre 안)에는 줄바꿈을 주지 않는다", () => {
    // `.rendered pre code` 가 줄바꿈을 얻으면 `.rendered pre` 의 가로 스크롤이 무의미해진다.
    const preCode = renderedCss.match(/\.rendered pre code \{[^}]*\}/)?.[0] ?? "";
    expect(preCode).not.toBe("");
    expect(preCode).not.toMatch(/overflow-wrap|word-break|white-space/);
  });

  it("내보낸 HTML에도 같은 규칙이 실린다", () => {
    const html = buildHtmlDocument({
      title: "노트",
      tokenBlock: "",
      renderedCss,
      bodyHtml: "",
    });
    expect(html).toMatch(RULE);
  });
});
