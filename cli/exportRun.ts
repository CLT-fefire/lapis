import { readFileSync } from "node:fs";
import path from "node:path";

import { parseNote } from "$lib/markdown";
import {
  EXPORT_BASE_CSS,
  buildHtmlDocument,
  buildRootTokenBlock,
  documentTitle,
  parseRootTokens,
  suggestHtmlFileName,
} from "$lib/previewExportDoc";
import { themeCss } from "$lib/colorThemes";
import { normPath } from "../mcp/cache.ts";

/**
 * `lapis export` — 노트 하나를 자립 HTML로.
 *
 * ## ⚠️ 앱의 내보내기와 무엇이 다른가
 *
 * 앱은 **라이브 DOM을 clone**한다. mermaid가 마운트 후 런타임에 `<svg>`가 되기 때문이다.
 * CLI에는 브라우저가 없으니 `parseNote()`의 HTML을 쓴다. 그래서:
 *
 * | | 앱 | CLI |
 * |---|---|---|
 * | mermaid | SVG로 박제 | **코드 펜스 그대로** |
 * | 토큰 값 | `getComputedStyle` (테마·사용자 CSS 반영) | `app.css` + 고른 색 테마 |
 * | 사용자 정의 CSS | 계산된 값에 이미 녹아 있다 | **반영 안 된다** |
 *
 * 이 차이는 숨기지 않는다 — `cli/README.md`에 표로 적혀 있고, 여기 주석이 그 짝이다.
 * 같은 노트를 두 경로로 내보내면 다를 수 있다는 것을 모르면 한쪽을 버그로 읽는다.
 */

export class ExportError extends Error {
  constructor(
    message: string,
    readonly remedy?: string,
  ) {
    super(message);
    this.name = "ExportError";
  }
}

export interface ExportOptions {
  /** 노트 절대 경로. */
  notePath: string;
  /** 리포 루트 — `app.css`와 `rendered.css`를 여기서 읽는다. */
  repoRoot: string;
  /** 색 테마 id. 없으면 기본 팔레트. */
  colorTheme?: string;
}

export interface ExportResult {
  html: string;
  /** 제안 파일명 — 호출부가 `--out` 없이 부를 때 쓴다. */
  fileName: string;
  /** 인라인한 이미지 수와 실패 수. */
  images: { inlined: number; failed: number };
}

/** 확장자 → data URI의 MIME. 모르는 것은 인라인하지 않는다(추측이 틀리면 안 뜬다). */
const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

/**
 * `<img src>` 를 data URI로. **로컬 파일만** 바꾼다.
 *
 * ⚠️ `http(s)` 는 그대로 둔다. 앱도 그렇게 한다 — 받아오려다 실패하면 이미지가 통째로
 * 사라지는데, 원본 URL을 남기면 온라인에서는 보인다.
 *
 * ⚠️ 실패를 **세어서 돌려준다.** 조용히 원본을 남기면 "자립"이라는 말이 거짓이 된다.
 */
function inlineImages(
  html: string,
  noteDir: string,
): { html: string; inlined: number; failed: number } {
  let inlined = 0;
  let failed = 0;
  const out = html.replace(/(<img[^>]*?src=")([^"]+)(")/g, (whole, pre, src, post) => {
    if (/^(https?:|data:)/i.test(src)) return whole;
    const ext = path.extname(src.split("?")[0]).toLowerCase();
    const mime = MIME[ext];
    if (!mime) {
      failed++;
      return whole;
    }
    try {
      const abs = path.isAbsolute(src) ? src : path.join(noteDir, decodeURIComponent(src));
      const b64 = readFileSync(abs).toString("base64");
      inlined++;
      return `${pre}data:${mime};base64,${b64}${post}`;
    } catch {
      failed++;
      return whole;
    }
  });
  return { html: out, inlined, failed };
}

export function runExport(opts: ExportOptions): ExportResult {
  let body: string;
  try {
    body = readFileSync(opts.notePath, "utf8");
  } catch {
    throw new ExportError(
      `노트를 읽을 수 없다: ${opts.notePath}`,
      "경로를 확인하라 — 인덱스에는 있는데 디스크에서 사라졌을 수 있다",
    );
  }

  const appCssPath = path.join(opts.repoRoot, "src", "app.css");
  const renderedCssPath = path.join(opts.repoRoot, "src", "lib", "styles", "rendered.css");
  let appCss: string;
  let renderedCss: string;
  try {
    appCss = readFileSync(appCssPath, "utf8");
    renderedCss = readFileSync(renderedCssPath, "utf8");
  } catch {
    // ⚠️ 여기서 조용히 넘어가면 **스타일 없는 HTML**이 나간다. 열리기는 열려서
    //    사용자는 자기가 뭔가 잘못한 줄 안다.
    throw new ExportError(
      "스타일시트를 읽을 수 없다 — 저장소가 온전하지 않다",
      `${appCssPath} 와 ${renderedCssPath} 가 있어야 한다`,
    );
  }

  const tokens = parseRootTokens(appCss);
  // 고른 색 테마를 얹는다 — 프리셋은 `:root` 블록이라 같은 해석기가 읽는다.
  const theme = opts.colorTheme ? themeCss(opts.colorTheme) : "";
  if (theme) {
    for (const [k, v] of parseRootTokens(theme)) tokens.set(k, v);
  }

  const parsed = parseNote(body);
  const imgs = inlineImages(parsed.html, path.dirname(opts.notePath));

  const html = buildHtmlDocument({
    // ⚠️ `$lib` 쪽은 **`/` 구분자**를 전제한다(`to_ui` 계약). 실제 호출부는 캐시에서 온
    //    경로라 이미 `/`지만, 네이티브 경로가 들어오면 제목에 **전체 경로가 통째로**
    //    박힌다 — 문서는 멀쩡히 나오고 탭 이름만 이상하다. 여기서 한 번 정규화한다.
    title: documentTitle(normPath(opts.notePath)),
    tokenBlock: buildRootTokenBlock(
      `${EXPORT_BASE_CSS}\n${renderedCss}`,
      (n) => tokens.get(n) ?? "",
    ),
    renderedCss,
    bodyHtml: imgs.html,
  });

  return {
    html,
    fileName: suggestHtmlFileName(opts.notePath),
    images: { inlined: imgs.inlined, failed: imgs.failed },
  };
}
