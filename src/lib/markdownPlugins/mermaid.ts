import type MarkdownIt from "markdown-it";

/**
 * ` ```mermaid ` 코드블록을 mermaid-host div로 변환.
 * 본문은 escapeHtml로 안전하게 `data-source` 속성에 보관 → 클라이언트 측 mermaid-runtime이
 * 디코드된 평문으로 다시 받아 렌더한다.
 *
 * mermaid 외 info-string의 fence는 원래 fence 렌더러 그대로 위임.
 */
export function mermaidPlugin(md: MarkdownIt): void {
  const orig = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, opts, env, slf) => {
    const token = tokens[idx];
    const info = (token.info || "").trim().toLowerCase();
    if (info === "mermaid") {
      const src = md.utils.escapeHtml(token.content);
      return `<div class="mermaid-host" data-source="${src}"></div>`;
    }
    return orig
      ? orig(tokens, idx, opts, env, slf)
      : slf.renderToken(tokens, idx, opts);
  };
}
