/**
 * 프리뷰 내용 → 자립형 HTML 파일 내보내기.
 *
 * **라이브 DOM을 clone한다** — 렌더된 마크다운 문자열(`parsed.html`)이 아니다.
 * Mermaid는 마운트 후 런타임에 `<svg>`로 치환되므로, 문자열을 쓰면 다이어그램이
 * 코드 펜스인 채로 나간다.
 *
 * "자립"의 기준(2026-08-03 사용자 결정):
 *   - CSS 인라인 — 쓰이는 토큰만 현재 실효 테마 값으로 박제
 *   - 이미지 data URI 임베드 — 다른 기기·브라우저에서도 그대로 보인다
 *   - Mermaid SVG 포함 — mermaid가 `<style>`을 SVG 안에 넣어줘 별도 처리 불필요
 *
 * 내보내는 범위는 `.rendered` **본문만**이다. Properties(frontmatter 표)와
 * Neighborhood(백링크)는 문서가 아니라 앱 UI라 제외한다.
 */

import { logError, logWarn } from "$lib/stores/usage";
import { m } from "$lib/paraglide/messages.js";
import { save, message } from "@tauri-apps/plugin-dialog";
import { writeBinaryFile } from "$lib/tauri/notes";
import renderedCss from "$lib/styles/rendered.css?raw";
import {
  EXPORT_BASE_CSS,
  buildHtmlDocument,
  buildRootTokenBlock,
  documentTitle,
  suggestHtmlFileName,
  stripAppOnlyNodes,
} from "$lib/previewExportDoc";

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader 실패"));
    reader.readAsDataURL(blob);
  });
}

export interface ImageInlineResult {
  inlined: number;
  failed: number;
}

/**
 * `<img>` 를 data URI로 바꾼다.
 *
 * 로컬 이미지는 이미 `asset://` URL이라(assetPath.ts의 `convertFileSrc`) webview에서
 * 그대로 `fetch` 할 수 있다 — `protocol-asset` 이 켜져 있어 별도 Rust 커맨드가 필요 없다.
 * 원격(http/https) 이미지도 시도하되, CORS로 막히면 **원본 URL을 남긴다** — 온라인에서
 * 열면 어차피 보이므로 실패로 취급할 이유가 없다.
 *
 * 개별 이미지 실패는 전체를 중단시키지 않는다. 이미지 하나 때문에 문서 전체를
 * 못 내보내는 쪽이 더 나쁘다.
 */
async function inlineImages(root: HTMLElement): Promise<ImageInlineResult> {
  const imgs = Array.from(root.querySelectorAll("img"));
  let inlined = 0;
  let failed = 0;

  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute("src") ?? "";
      if (!src || src.startsWith("data:")) return;
      try {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        img.setAttribute("src", await blobToDataUrl(await res.blob()));
        inlined++;
      } catch (e) {
        failed++;
        // 원본 경로를 함께 남긴다 — asset:// URL만으로는 어느 파일인지 알기 어렵다.
        logWarn("previewExport", "[export] 이미지 인라인 실패", img.dataset.absPath ?? src, e);
      }
      // 지연 로딩은 앱 프리뷰용 최적화 — 정적 문서에선 의미가 없다.
      img.removeAttribute("loading");
    }),
  );

  return { inlined, failed };
}

/**
 * 프리뷰 본문을 HTML 파일로 저장한다.
 *
 * @param article 라이브 `article.rendered` 엘리먼트.
 * @param notePath 현재 노트 절대 경로 — 기본 파일명·`<title>` 도출용.
 *
 * throw 하지 않는다. save 취소는 정상 흐름(알림 없이 종료), 그 외 실패는
 * 네이티브 에러 다이얼로그로 알린다 — mermaid PNG 내보내기와 같은 규약.
 */
/**
 * 라이브 DOM → 자립 HTML **문자열**. 저장은 부르는 쪽이 한다.
 *
 * ## ⚠️ 왜 갈랐나
 *
 * 이 조립을 쓰는 곳이 둘이 됐다 — 사용자가 고르는 저장 대화상자와, **밖에서 시킨
 * 렌더**(`lapis_render`). 각자 조립하면 두 문서가 달라지고, 그건 "앱에서 내보낸 것과
 * MCP 로 뽑은 것이 다르다"가 된다.
 *
 * ⚠️ 토큰 해석 기준을 **article** 로 잡는다(`:root` 가 아니라). 커스텀 프로퍼티는
 * 상속되므로 article 의 computed style 에는 `:root` 토큰이 전부 들어 있고, 거기에 더해
 * 인라인으로 걸린 `--reading-font-size` 까지 잡힌다 — 사용자가 `Aa` 로 키운 글꼴 크기가
 * 내보낸 문서에도 그대로 반영되는 이유다.
 */
export async function buildPreviewHtml(
  article: HTMLElement,
  notePath: string | null | undefined,
): Promise<{ html: string; images: ImageInlineResult }> {
  const clone = article.cloneNode(true) as HTMLElement;
  stripAppOnlyNodes(clone);
  const images = await inlineImages(clone);
  const computed = getComputedStyle(article);
  const tokenBlock = buildRootTokenBlock(
    `${EXPORT_BASE_CSS}\n${renderedCss}`,
    (name) => computed.getPropertyValue(name),
  );
  const html = buildHtmlDocument({
    title: documentTitle(notePath),
    tokenBlock,
    renderedCss,
    bodyHtml: clone.innerHTML,
  });
  return { html, images };
}

export async function exportPreviewToHtml(
  article: HTMLElement | null | undefined,
  notePath: string | null | undefined,
): Promise<void> {
  if (!article) return;

  let html: string;
  let images: ImageInlineResult;
  try {
    const built = await buildPreviewHtml(article, notePath);
    html = built.html;
    images = built.images;
  } catch (err) {
    await notifyExportError(m.export_html_convert_failed(), err);
    return;
  }

  const targetPath = await save({
    defaultPath: suggestHtmlFileName(notePath),
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!targetPath) return; // 사용자 취소 — 에러 아님

  try {
    await writeBinaryFile(targetPath, new TextEncoder().encode(html));
  } catch (err) {
    await notifyExportError(m.export_html_save_failed(), err);
    return;
  }

  // 이미지를 하나라도 못 넣었으면 조용히 넘어가지 않는다 — 파일은 생겼지만
  // 그 이미지는 어디서 열든 깨진 상태다.
  if (images.failed > 0) {
    await message(
      m.export_images_missing_body({ failed: images.failed, inlined: images.inlined }),
      { title: m.export_images_missing_title(), kind: "warning" },
    );
  }
}

async function notifyExportError(summary: string, err: unknown): Promise<void> {
  const detail = err instanceof Error ? err.message : String(err);
  logError("previewExport", "[export] HTML 내보내기 실패:", err);
  try {
    await message(`${summary}\n\n${detail}`, {
      title: m.export_html_error_title(),
      kind: "error",
    });
  } catch {
    /* message 다이얼로그 자체 실패 — 콘솔 로그는 이미 남겼다 */
  }
}
