import { invoke } from "$lib/tauri/invoke";
import { convertFileSrc } from "@tauri-apps/api/core";

/** `C:` 같은 Windows 드라이브 지정자. 경로의 루트를 판정·복원할 때 쓴다. */
const DRIVE_PREFIX = /^[A-Za-z]:$/;

/**
 * 노트의 부모 디렉토리 절대 경로.
 */
function parentDir(notePath: string): string {
  const i = notePath.lastIndexOf("/");
  return i === -1 ? "" : notePath.slice(0, i);
}

/**
 * 절대 경로 판정 — POSIX(`/...`)와 Windows(`C:/...`) 양쪽.
 *
 * Rust가 프런트로 넘기는 경로는 항상 `/` 구분자다(`vault.rs`의 UI 경로 정규화).
 * 그래서 여기서 갈리는 건 **드라이브 지정자 유무**뿐이다.
 */
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || DRIVE_PREFIX.test(p.slice(0, 2));
}

/**
 * 노트의 상대 src를 절대 path로 변환. `../` 정규화 포함.
 * - src가 절대 경로면 그대로 반환 (`/...` 또는 `C:/...`)
 * - 그 외엔 노트 부모 + src 조합 후 `.`, `..` 정리
 *
 * ⚠️ **드라이브 지정자는 세그먼트 정규화에서 빼둔다.** `C:`를 일반 세그먼트로 흘리면
 * `..`이 드라이브를 먹어치우고(`C:/a` + `../../x` → `/x`), 결과에도 `/C:/a/x`처럼
 * 앞 슬래시가 붙어 `convertFileSrc`가 존재하지 않는 경로를 만든다.
 */
export function joinNotePath(notePath: string, src: string): string {
  if (isAbsolutePath(src)) return src;

  const base = parentDir(notePath) + "/" + src;
  const drive = DRIVE_PREFIX.test(base.slice(0, 2)) ? base.slice(0, 2) : "";
  const rest = drive ? base.slice(2) : base;

  const stack: string[] = [];
  for (const seg of rest.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (stack.length > 0) stack.pop();
      continue;
    }
    stack.push(seg);
  }
  return `${drive}/${stack.join("/")}`;
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
