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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    host.innerHTML = `<pre class="mermaid-error">Mermaid 렌더 실패: ${escapeText(
      msg,
    )}\n\n${escapeText(source)}</pre>`;
    host.dataset.rendered = "error";
  }
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
