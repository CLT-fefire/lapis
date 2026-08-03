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

/* 본문 폭 제한 — 앱에서는 페인이 폭을 잡아주지만 브라우저 전체 폭에선 너무 길어진다. */
.rendered {
  max-width: 900px;
  margin: 0 auto;
}

.rendered img {
  max-width: 100%;
  height: auto;
}`;

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
