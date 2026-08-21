/**
 * Mermaid 렌더 런타임.
 *
 * - 동적 import: Preview에서 첫 mermaid 블록 발견 시 mermaid.js를 1회 로드, 이후 캐시
 * - IntersectionObserver: rootMargin 200px. 가시 영역 진입 시 lazy 렌더
 * - data-rendered 가드: "pending" / "1" / "error" 어느 것이든 중복 렌더 회피
 *
 * 호출자는 Preview HTML이 갱신될 때마다 renderMermaidIn(previewContainer)을 호출하면 된다.
 * DOM에서 제거된 host의 observer 참조는 자동 dropreference — 별도 cleanup 불필요.
 */

import { m } from "$lib/paraglide/messages.js";
import { resolveEffectiveTheme } from "$lib/stores/theme";

type MermaidModule = typeof import("mermaid");

let mermaidPromise: Promise<MermaidModule> | null = null;

function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid");
  }
  return mermaidPromise;
}

/**
 * 렌더 직전마다 현재 실효 테마(라이트/다크)로 mermaid를 (재)초기화한다.
 * theme는 전역 설정이라 매 렌더 시 적용해야 라이트/다크 전환이 반영된다.
 * 라이트 → "default"(밝은 배경·어두운 글씨), 다크 → "dark".
 */
function applyMermaidTheme(mermaid: MermaidModule["default"]): void {
  mermaid.initialize({
    startOnLoad: false,
    theme: resolveEffectiveTheme() === "light" ? "default" : "dark",
    securityLevel: "strict",
    // ⚠️ 반드시 true. false(기본값)면 mermaid가 파싱 실패 시 **자기 에러 그림**
    // ("Syntax error in text" 폭탄 아이콘)을 그리는데, 컨테이너를 넘기지 않는 render()는
    // 그 그림을 `document.body`에 붙인 `div#d{id}`에 넣고 **정리하지 않고 throw** 한다
    // (mermaid 11.15.0 render(): `if (Oe(), T) throw T;` — 성공 경로의 removeTempElements를 건너뜀).
    // id가 렌더마다 유일하므로 다음 렌더의 removeExistingElements도 못 지운다 →
    // 노트를 바꿔도 화면 하단에 폭탄 그림이 영구 잔류했다. true면 mermaid가 임시 노드를
    // 지우고 그냥 throw 하고, 실패 표시는 아래 catch의 인라인 `.mermaid-error`가 맡는다.
    suppressErrorRendering: true,
    // PNG 내보내기 호환: htmlLabels(true)는 라벨을 <foreignObject>(HTML)로 그려
    // WKWebView canvas 래스터화 시 라벨이 통째로 누락된다. <text> 라벨을 강제해
    // export가 항상 정상 동작하게 한다. (Preview 표시 차이는 미미)
    flowchart: { htmlLabels: false },
  });
}

let sharedObserver: IntersectionObserver | null = null;
let renderCounter = 0;

async function renderHost(host: HTMLElement): Promise<void> {
  // pending/1/error 어떤 상태라도 다시 처리하지 않음
  if (host.dataset.rendered) return;
  host.dataset.rendered = "pending";
  const source = host.dataset.source ?? "";
  const id = `m-${++renderCounter}-${Date.now()}`;
  try {
    const { default: mermaid } = await loadMermaid();
    applyMermaidTheme(mermaid);
    const { svg } = await mermaid.render(id, source);
    host.innerHTML = svg;
    host.dataset.rendered = "1";
    // innerHTML 교체 "이후"에 버튼 추가 (문자열에 같이 넣으면 SVG가 덮어씀)
    appendExportButton(host);
  } catch (e) {
    // suppressErrorRendering이 mermaid 쪽 정리를 맡지만, 그 경로를 통과하지 못한
    // 실패(렌더 도중 예외 등)까지 덮도록 우리가 만든 id의 임시 노드를 직접 지운다.
    removeMermaidTempNodes(id);
    const msg = e instanceof Error ? e.message : String(e);
    host.innerHTML = `<pre class="mermaid-error">Mermaid 렌더 실패: ${escapeText(
      msg,
    )}\n\n${escapeText(source)}</pre>`;
    host.dataset.rendered = "error";
  }
}

/**
 * 렌더 성공한 host 우상단에 PNG 내보내기 hover 버튼 추가.
 * 클릭 처리는 +page.svelte의 handlePreviewClick 이벤트 위임에서 분기한다.
 */
function appendExportButton(host: HTMLElement): void {
  if (host.querySelector(".mermaid-export-btn")) return; // 중복 방어
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mermaid-export-btn";
  btn.title = m.mermaid_save_png();
  btn.textContent = "⬇ PNG";
  host.appendChild(btn);
}

/**
 * mermaid가 `render(id, ...)`에서 `document.body`에 붙이는 임시 노드를 제거한다.
 * 이름 규칙은 mermaid 내부와 같다 — svg `#{id}` · 감싸는 div `#d{id}` · sandbox iframe `#i{id}`.
 */
function removeMermaidTempNodes(id: string): void {
  for (const domId of [id, `d${id}`, `i${id}`]) {
    document.getElementById(domId)?.remove();
  }
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 테마 전환 시 호출 — 이미 렌더된 다이어그램의 data-rendered 가드를 풀어
 * renderMermaidIn이 새 테마로 다시 렌더하도록 한다. (SVG는 테마별로 baked되어
 * CSS 토큰처럼 자동 적응하지 못하므로 명시적 재렌더가 필요하다.)
 */
export function resetMermaidHosts(container: HTMLElement): void {
  container
    .querySelectorAll<HTMLElement>(".mermaid-host[data-rendered]")
    .forEach((h) => {
      delete h.dataset.rendered;
    });
}

export function renderMermaidIn(container: HTMLElement): void {
  const hosts = container.querySelectorAll<HTMLElement>(
    ".mermaid-host:not([data-rendered])",
  );
  if (hosts.length === 0) return;

  // SSR / 테스트 환경 대비
  if (typeof IntersectionObserver === "undefined") {
    hosts.forEach((h) => void renderHost(h));
    return;
  }

  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            sharedObserver!.unobserve(e.target);
            void renderHost(e.target as HTMLElement);
          }
        }
      },
      { rootMargin: "200px" },
    );
  }
  hosts.forEach((h) => sharedObserver!.observe(h));
}
