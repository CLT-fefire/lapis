import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * 노트의 부모 디렉토리 절대 경로.
 */
function parentDir(notePath: string): string {
  const i = notePath.lastIndexOf("/");
  return i === -1 ? "" : notePath.slice(0, i);
}

/**
 * 노트의 상대 src를 절대 path로 변환. `../` 정규화 포함.
 * - src가 `/`로 시작하면 절대 경로로 간주, 그대로 반환
 * - 그 외엔 노트 부모 + src 조합 후 `.`, `..` 정리
 */
export function joinNotePath(notePath: string, src: string): string {
  if (src.startsWith("/")) return src;
  const combined = (parentDir(notePath) + "/" + src).split("/");
  const stack: string[] = [];
  for (const seg of combined) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (stack.length > 0) stack.pop();
      continue;
    }
    stack.push(seg);
  }
  return "/" + stack.join("/");
}

/**
 * Preview 컨테이너 안의 모든 `<img>`에 대해 src 재작성:
 * - http(s):, data:, asset:, tauri: 스킴은 그대로 (이미 처리됨 또는 외부)
 * - 그 외는 절대 path로 변환 후 `convertFileSrc()`로 asset 프로토콜 URL 적용
 * - `loading="lazy"` 자동 부여
 * - `data-src-rewritten=1` 가드로 중복 처리 회피
 */
export function rewriteImageSources(
  container: HTMLElement,
  notePath: string,
): void {
  const imgs = container.querySelectorAll<HTMLImageElement>(
    "img:not([data-src-rewritten])",
  );
  for (const img of imgs) {
    const src = img.getAttribute("src") ?? "";
    if (!src) {
      img.dataset.srcRewritten = "1";
      continue;
    }
    if (/^(https?:|data:|asset:|tauri:)/i.test(src)) {
      img.dataset.srcRewritten = "1";
      continue;
    }
    const absolute = joinNotePath(notePath, src);
    img.src = convertFileSrc(absolute);
    // 원본 절대 경로 박제 — src가 asset:// URL로 덮여 쓰이면 어느 파일인지 알 수 없다.
    // HTML 내보내기가 이미지 인라인에 실패했을 때 이 값으로 로그를 남긴다.
    img.dataset.absPath = absolute;
    img.loading = "lazy";
    img.dataset.srcRewritten = "1";
  }
}
