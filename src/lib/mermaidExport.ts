/**
 * Mermaid 다이어그램 → PNG 내보내기.
 *
 * Preview에 렌더된 mermaid SVG를 canvas로 래스터화해 PNG Blob을 만들고,
 * save 다이얼로그로 고른 경로에 Rust `write_binary_file`(atomic)로 저장한다.
 *
 * - 배경: 실효 테마에 맞춰 불투명 채움 (다크 → `#1e1e1e`, 라이트 → `#ffffff`).
 *   다이어그램 글씨색이 테마별로 다르므로 배경도 맞춰야 대비가 유지된다.
 * - scale 3x 고해상도. 단 WebKit canvas 면적 한계를 넘기면 자동으로 배율을 낮춰
 *   빈/검은 PNG가 나오지 않게 한다.
 * - foreignObject 라벨(htmlLabels)은 WKWebView canvas에서 누락되므로,
 *   mermaid-runtime.ts에서 `flowchart.htmlLabels: false`로 `<text>` 라벨을 강제한다.
 */

import { m } from "$lib/paraglide/messages.js";
import { save, message } from "@tauri-apps/plugin-dialog";
import { writeBinaryFile } from "$lib/tauri/notes";
import { logError, logWarn } from "$lib/stores/usage";

const SCALE = 3;
/** 다이어그램 테마(라이트/다크)에 맞춘 불투명 PNG 배경. */
function exportBackground(): string {
  // 테마가 다크 하나뿐이라 고정이다. 다시 늘어나면 여기가 갈라진다.
  return "#1e1e1e";
}
/** WebKit(WKWebView) canvas 면적 한계 ≈ 16,777,216 px² (≈4096×4096). 초과 시 빈/검은 출력. */
const MAX_CANVAS_AREA = 16_777_216;

/**
 * SVG 엘리먼트를 PNG Blob으로 변환.
 *
 * viewBox(없으면 렌더된 bounding rect)에서 내재 크기를 얻고, 명시적 width/height +
 * xmlns를 보강한 clone을 직렬화해 `<img>`로 로드 → canvas에 배경 fill 후 drawImage →
 * `toBlob`.
 *
 * ⚠️ URL은 반드시 인라인 `data:` URL이어야 한다. WKWebView(WebKit)는 `blob:` URL로
 * 로드한 SVG를 canvas에 그리면 origin-clean 플래그를 꺼서(canvas taint) `toBlob`이
 * `SecurityError: "The operation is insecure."`를 던진다. 같은 origin이라도 blob+SVG
 * 조합이면 taint된다(WebKit 고유 동작). `data:` URL은 완전 인라인이라 taint되지 않는다.
 * mermaid flowchart SVG는 `<style>` 인라인 + foreignObject 없음(htmlLabels:false)이라
 * 그 외 외부 참조가 없어 data URL로 안전하게 래스터화된다.
 *
 * 배율은 기본 3x이되, `width*height*scale²`가 WebKit canvas 면적 한계를 넘으면 그에
 * 맞춰 배율을 내려잡는다(큰 다이어그램이 빈/검은 PNG로 저장되는 사고 방지).
 */
export async function svgElementToPngBlob(svg: SVGSVGElement): Promise<Blob> {
  // 크기: viewBox 우선, 없으면 화면 렌더 크기, 그것도 0이면 안전 기본값
  const vb = svg.viewBox.baseVal;
  const rect = svg.getBoundingClientRect();
  const width = (vb && vb.width) || rect.width || 800;
  const height = (vb && vb.height) || rect.height || 600;

  // 면적 한계에 맞춘 배율 클램프 — 기본 3x를 넘지 않되, 한계 초과 시 더 낮게.
  const fitScale = Math.sqrt(MAX_CANVAS_AREA / (width * height));
  const scale = Math.min(SCALE, fitScale);
  if (scale < SCALE) {
    logWarn(
      "mermaidExport",
      `다이어그램이 커서 배율을 ${SCALE}x → ${scale.toFixed(2)}x로 낮춤 ` +
        `(${Math.round(width)}×${Math.round(height)})`,
    );
  }

  // 폰트 metric 안정화 후 직렬화 (text 라벨 위치 어긋남 방지)
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* 폰트 로딩 실패는 치명적이지 않음 — 그대로 진행 */
    }
  }

  // 명시적 크기 + xmlns 보강한 clone 직렬화 (img 내재 크기 확정)
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  const svgString = new XMLSerializer().serializeToString(clone);

  // ⚠️ blob: URL이 아닌 data: URL을 쓴다 — WKWebView에서 blob+SVG는 canvas를
  // taint시켜 toBlob이 SecurityError("The operation is insecure.")로 죽는다.
  // (charset=utf-8 + encodeURIComponent로 한국어 등 멀티바이트 라벨 보존)
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;

  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context 생성 실패");

  ctx.fillStyle = exportBackground();
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.drawImage(img, 0, 0, width, height);

  return await canvasToBlob(canvas);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("SVG 이미지 로드 실패"));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas.toBlob 실패 (canvas tainted 가능)"));
    }, "image/png");
  });
}

let exportSeq = 0;

/**
 * mermaid-host 내부 SVG를 PNG로 저장.
 *
 * @param host `.mermaid-host` 엘리먼트. 내부 `<svg>`가 없으면(error/pending) no-op.
 * @param defaultBaseName 기본 파일명 base — 호출부에서 `$currentNotePath` stem으로 도출해 전달.
 *   (util은 Svelte store 접근 불가)
 *
 * 실패 시 네이티브 에러 다이얼로그로 사용자에게 알린다(throw 하지 않음).
 * save 취소는 정상 흐름 — 알림 없이 종료.
 */
export async function exportMermaidHostToPng(
  host: HTMLElement,
  defaultBaseName: string,
): Promise<void> {
  const svg = host.querySelector("svg");
  if (!svg) return; // error/pending 상태 — 내보낼 SVG 없음

  let blob: Blob;
  try {
    blob = await svgElementToPngBlob(svg as SVGSVGElement);
  } catch (err) {
    // 다이얼로그 전 단계(taint/면적 한계 등) 실패 — 버튼이 죽은 듯 보이지 않게 알림
    await notifyExportError(m.mermaid_convert_failed(), err);
    return;
  }

  const base = defaultBaseName.trim() || "diagram";
  const suggested = `${base}-diagram-${++exportSeq}.png`;

  const targetPath = await save({
    defaultPath: suggested,
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (!targetPath) return; // 사용자 취소 — 에러 아님

  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await writeBinaryFile(targetPath, bytes);
  } catch (err) {
    // 저장 단계(권한/디스크/경로) 실패 — 파일이 안 생기는데 무반응이 되지 않게 알림
    await notifyExportError(m.mermaid_save_failed(), err);
  }
}

async function notifyExportError(summary: string, err: unknown): Promise<void> {
  const detail = err instanceof Error ? err.message : String(err);
  logError("mermaidExport", "mermaid PNG 내보내기 실패:", err);
  try {
    await message(`${summary}\n\n${detail}`, {
      title: m.mermaid_export_error_title(),
      kind: "error",
    });
  } catch {
    /* message 다이얼로그 자체 실패 시 무시 — 콘솔 로그는 이미 남김 */
  }
}
