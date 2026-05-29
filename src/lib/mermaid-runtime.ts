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

type MermaidModule = typeof import("mermaid");

let mermaidPromise: Promise<MermaidModule> | null = null;

function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "strict",
        // PNG 내보내기 호환: htmlLabels(true)는 라벨을 <foreignObject>(HTML)로 그려
        // WKWebView canvas 래스터화 시 라벨이 통째로 누락된다. <text> 라벨을 강제해
        // export가 항상 정상 동작하게 한다. (Preview 표시 차이는 미미)
        flowchart: { htmlLabels: false },
      });
      return mod;
    });
  }
  return mermaidPromise;
}

let sharedObserver: IntersectionObserver | null = null;
let renderCounter = 0;

async function renderHost(host: HTMLElement): Promise<void> {
  // pending/1/error 어떤 상태라도 다시 처리하지 않음
  if (host.dataset.rendered) return;
  host.dataset.rendered = "pending";
  const source = host.dataset.source ?? "";
  try {
    const { default: mermaid } = await loadMermaid();
    const id = `m-${++renderCounter}-${Date.now()}`;
    const { svg } = await mermaid.render(id, source);
    host.innerHTML = svg;
    host.dataset.rendered = "1";
    // innerHTML 교체 "이후"에 버튼 추가 (문자열에 같이 넣으면 SVG가 덮어씀)
    appendExportButton(host);
  } catch (e) {
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
  btn.title = "PNG로 저장";
  btn.textContent = "⬇ PNG";
  host.appendChild(btn);
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
