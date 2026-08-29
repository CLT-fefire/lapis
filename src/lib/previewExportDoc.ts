/**
 * 프리뷰 HTML 내보내기 — **순수 로직** (DOM·Tauri 무의존).
 *
 * vitest가 node 환경이라 DOM을 쓰는 부분은 테스트할 수 없다. 그래서 문자열로
 * 환원되는 조립·해석 로직만 여기 모아 테스트하고, DOM 조작과 파일 저장은
 * `previewExport.ts`가 맡는다. (Tauri 플러그인을 import하는 모듈을 node 테스트에서
 * 불러오면 로드 단계에서 깨지는 것도 함께 피한다.)
 */

/** `var(--name)` / `var(--name, fallback)` 에서 토큰 이름만 뽑는다. */
export function collectCssVarNames(css: string): string[] {
  const names: string[] = [];
  const re = /var\(\s*(--[A-Za-z0-9_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) names.push(m[1]);
  return names;
}

/**
 * CSS가 참조하는 토큰을 실제 값으로 해석해 `:root{}` 블록을 만든다.
 *
 * 내보낸 HTML은 앱의 `app.css`를 갖지 못하므로 토큰 정의가 통째로 사라진다.
 * 그래서 **쓰이는 토큰만 골라** 현재 실효 테마 기준의 값으로 박제한다
 * (라이트/다크가 자연스럽게 반영되는 이유).
 *
 * 해석된 값이 또 `var()`를 참조하면(예: `--surface-base: var(--n-50)`) 그 이름도
 * 따라가 더 나올 게 없을 때까지 확장한다. `getComputedStyle`이 이미 치환된 값을
 * 주는 경우가 대부분이라 보통은 1회에 끝나지만, 안전장치로 둔다.
 *
 * @param resolve 토큰 이름 → 값. 정의가 없으면 빈 문자열을 반환해야 한다
 *   (그 경우 선언을 생략해 CSS에 적힌 fallback이 살아남는다).
 */
/**
 * 스타일시트의 **무조건적인 `:root`** 블록에서 커스텀 프로퍼티를 읽는다.
 *
 * ## ⚠️ 왜 브라우저 없이 읽어야 하나
 *
 * 앱은 `getComputedStyle`로 살아 있는 값을 읽는다 — 색 테마와 사용자 CSS가 이미 반영된
 * 값이다. **CLI에는 브라우저가 없다.** 그래서 `app.css`를 직접 읽는다.
 *
 * ⚠️ **조건이 붙은 root는 안 읽는다.** `:root[data-density="compact"]`는 그 밀도를 고른
 * 사람에게만 참이다. 무조건 가져오면 안 고른 사람의 문서에 compact 간격이 박힌다 —
 * 문서는 열리고 글자만 촘촘하다. 아무도 왜인지 모른다.
 */
/**
 * `--a: 1px; --b: url(data:image/png;base64,AA);` → 선언 목록.
 *
 * ⚠️ **`;`로 그냥 쪼개면 안 된다.** data URI 안에 `;`가 들어간다(`image/png;base64`).
 * 괄호 깊이를 세서 괄호 안의 `;`는 값의 일부로 둔다. 이걸 놓치면 이미지 하나가 값의
 * 절반만 박힌 채로 나가고, 문서는 열리되 그림만 안 나온다.
 */
function splitDeclarations(body: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= body.length; i++) {
    const ch = body[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (i !== body.length && !(ch === ";" && depth === 0)) continue;
    const chunk = body.slice(start, i);
    start = i + 1;
    const colon = chunk.indexOf(":");
    if (colon === -1) continue;
    const name = chunk.slice(0, colon).trim();
    if (!name.startsWith("--")) continue;
    out.push([name, chunk.slice(colon + 1).trim()]);
  }
  return out;
}

export function parseRootTokens(css: string): Map<string, string> {
  const out = new Map<string, string>();
  // 선택자가 정확히 `:root` 인 블록만. 앞에 다른 선택자가 붙은 것도 제외한다.
  const blocks = css.matchAll(/(^|[}\s])(:root)\s*\{([^}]*)\}/g);
  for (const b of blocks) {
    // 주석을 먼저 걷어낸다 — 주석 안의 `--x: y;` 가 값으로 잡히면 조용히 틀린다.
    const body = b[3].replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [name, value] of splitDeclarations(body)) out.set(name, value);
  }
  return out;
}

export function buildRootTokenBlock(
  css: string,
  resolve: (name: string) => string,
): string {
  const seen = new Set<string>();
  const queue = collectCssVarNames(css);
  const decls: string[] = [];

  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (seen.has(name)) continue;
    seen.add(name);

    const value = resolve(name).trim();
    if (!value) continue; // 미정의 — CSS에 적힌 fallback에 맡긴다

    decls.push(`  ${name}: ${value};`);
    for (const nested of collectCssVarNames(value)) queue.push(nested);
  }

  // 커스텀 프로퍼티는 선언 순서와 무관하게 해석되므로 정렬해도 안전하다.
  // 정렬해두면 같은 노트를 두 번 내보냈을 때 결과가 바이트 단위로 같아 diff가 깨끗하다.
  decls.sort();
  return `:root {\n${decls.join("\n")}\n}`;
}

/**
 * 내보낸 문서의 기본 레이아웃. 앱 셸이 없으므로 body 배경·글꼴·여백을 여기서 세운다.
 * 여기 쓰인 토큰도 `buildRootTokenBlock`의 수집 대상에 포함시켜야 한다.
 *
 * 본문 폭 제한·이미지 축소는 여기가 아니라 `rendered.css`의 `.rendered`가 갖는다
 * (2026-08-06 이전). 여기 있던 `max-width: 900px`는 "앱에서는 페인이 폭을 잡아준다"는
 * 가정이었는데, v1.6.0에서 Editor 접힘이 기본이 되며 그 가정이 깨졌다 — **앱보다 내보낸
 * 문서가 더 읽기 좋은** 상태였다. 이제 양쪽 다 `--reading-measure`를 따르고, 설정에서
 * 폭 제한을 끄면 내보낸 문서도 함께 풀린다(글꼴 크기가 이미 그렇게 동작한다).
 *
 * ⚠️ 이 문자열 안에 백틱을 쓰지 말 것 — 템플릿 리터럴이 거기서 끊긴다.
 */
export const EXPORT_BASE_CSS = `*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 32px 28px;
  background: var(--surface-base, #ffffff);
  color: var(--text-primary, #1a1a1a);
  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  -webkit-font-smoothing: antialiased;
}

/*
  인쇄 — 브라우저의 "PDF 로 저장"이 이걸 쓴다.

  ⚠️ PDF 라이브러리를 안 들인다. 자립 HTML 은 이미 있고, 브라우저는 어디에나 있다.
     라이브러리를 들이면 글꼴·CJK·수식이 전부 우리 문제가 된다.
*/
@media print {
  body {
    padding: 0;
    /* 종이는 하얗다. 화면 배경을 그대로 인쇄하면 토너를 붓는다. */
    background: #ffffff;
    color: #000000;
  }

  /* ⚠️ 링크 주소를 뒤에 붙인다 — 종이에서는 눌러도 아무 일이 없다. */
  a[href^="http"]::after {
    content: " (" attr(href) ")";
    font-size: 0.85em;
    word-break: break-all;
  }

  /* 내부 링크는 안 붙인다 — 슬러그만 나와도 읽는 사람에게 뜻이 없다. */
  a:not([href^="http"])::after {
    content: none;
  }

  /* 제목이 페이지 맨 아래에 혼자 남지 않게. */
  h1,
  h2,
  h3,
  h4 {
    break-after: avoid;
    page-break-after: avoid;
  }

  /* 코드·표·그림은 쪼개지면 못 읽는다. */
  pre,
  table,
  blockquote,
  figure,
  img,
  svg {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  pre {
    /* 화면에서는 가로로 스크롤하지만 종이에는 스크롤이 없다 — 잘리면 그냥 사라진다. */
    white-space: pre-wrap;
    word-break: break-word;
  }

  /*
    ⚠️ 이미지 폭은 여기서 안 정한다 — rendered.css 의 .rendered 가 이미 갖는다.
       같은 규칙을 두 곳에 두면 갈린다(previewExportDoc.test.ts 가 그걸 막는다).
  */
}`;

/**
 * 앱에서만 뜻이 있는 요소를 걷어낸다. **clone 위에서만 부를 것.**
 *
 * ## 🔴 검색어가 내보낸 문서에 박제되면 안 된다
 *
 * 문서 내 검색(`⌘F`)은 본문에 `<mark class="lapis-search-match">` 를 심는다. 그대로
 * 내보내면 **내보낸 순간 무엇을 찾고 있었는지가 파일에 남는다** — 남에게 보내는 파일이면
 * 특히 곤란하고, 에러는 나지 않으므로 본인도 모른다.
 *
 * ⚠️ 요소만 벗기고 **안의 텍스트는 남긴다.** 통째로 지우면 본문에서 그 낱말이 사라진다.
 *
 * ⚠️ `previewExport.ts` 가 아니라 여기 있는 이유는 캔버스·파일 대화상자가 안 붙어야
 * 테스트가 되기 때문이다. 저 파일은 이걸 부르기만 한다.
 */
export function stripAppOnlyNodes(root: HTMLElement): void {
  // Mermaid hover PNG 버튼 — 정적 문서에선 눌러도 아무 일이 없다.
  root.querySelectorAll(".mermaid-export-btn").forEach((el) => el.remove());

  root
    .querySelectorAll("mark.lapis-search-match, mark.lapis-search-current")
    .forEach((el) => el.replaceWith(...Array.from(el.childNodes)));
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 노트 경로 → save 다이얼로그 기본 파일명. */
export function suggestHtmlFileName(notePath: string | null | undefined): string {
  const base = (notePath ?? "").split("/").pop() ?? "";
  const stem = base.replace(/\.(md|mmd|markdown)$/i, "").trim();
  return `${stem || "note"}.html`;
}

/** 노트 경로 → 문서 `<title>`. */
export function documentTitle(notePath: string | null | undefined): string {
  return suggestHtmlFileName(notePath).replace(/\.html$/, "");
}

export interface HtmlDocumentParts {
  title: string;
  /** `buildRootTokenBlock` 산출물. */
  tokenBlock: string;
  /** `rendered.css` 원문 (?raw). */
  renderedCss: string;
  /** `.rendered` 서브트리 innerHTML. */
  bodyHtml: string;
}

/**
 * 완결된 단일 HTML 문서를 조립한다. 외부 참조가 없어야 하므로 CSS는 전부 인라인이고
 * 이미지는 호출부에서 미리 data URI로 바꿔 넣는다.
 */
export function buildHtmlDocument(parts: HtmlDocumentParts): string {
  const { title, tokenBlock, renderedCss, bodyHtml } = parts;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Lapis">
<title>${escapeHtml(title)}</title>
<style>
${tokenBlock}

${EXPORT_BASE_CSS}

${renderedCss.trim()}
</style>
</head>
<body>
<article class="rendered">
${bodyHtml}
</article>
</body>
</html>
`;
}
