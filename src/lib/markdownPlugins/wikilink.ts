import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

const OPEN = 0x5b; // '['

/**
 * markdown-it 인라인 룰: `[[target]]` 또는 `[[target|alias]]`를 wikilink 토큰으로 인식.
 * 렌더 결과: `<a class="wikilink" data-target="...">표시텍스트</a>`
 *
 * resolved/unresolved 상태는 markdown-it가 알 수 없으므로,
 * 호출 측(+page.svelte)에서 렌더 후 DOM 후처리로 클래스 부여.
 */
export function wikilinkPlugin(md: MarkdownIt): void {
  md.inline.ruler.before("link", "wikilink", (state: StateInline, silent: boolean) => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== OPEN) return false;
    if (state.src.charCodeAt(start + 1) !== OPEN) return false;

    const close = state.src.indexOf("]]", start + 2);
    if (close === -1) return false;

    const inner = state.src.slice(start + 2, close);
    if (inner.includes("\n") || inner.includes("[[")) return false;

    if (!silent) {
      const pipeIdx = inner.indexOf("|");
      const target = (pipeIdx === -1 ? inner : inner.slice(0, pipeIdx)).trim();
      const display = (pipeIdx === -1 ? target : inner.slice(pipeIdx + 1)).trim();
      if (!target) return false;

      const token = state.push("wikilink", "", 0);
      token.content = display;
      token.meta = { target };
    }

    state.pos = close + 2;
    return true;
  });

  md.renderer.rules.wikilink = (tokens, idx) => {
    const token = tokens[idx];
    const target = (token.meta as { target?: string } | undefined)?.target ?? "";
    const display = token.content ?? target;
    const safeTarget = md.utils.escapeHtml(target);
    const safeDisplay = md.utils.escapeHtml(display);
    // span 사용 — a 태그의 default navigation 위험 회피.
    // 키보드 접근성을 위해 role/tabindex 부여.
    return `<span class="wikilink" data-target="${safeTarget}" role="link" tabindex="0">${safeDisplay}</span>`;
  };
}
