import type MarkdownIt from "markdown-it";
import { SAVED_QUERY_FENCE } from "$lib/savedQuery";

/**
 * ` ```lapis-query ` 코드블록을 **자리(host)** 로 바꾼다.
 *
 * markdown-it 은 vault 를 모른다. 그래서 여기서는 자리만 만들고, 결과는 클라이언트의
 * `queryRuntime` 이 채운다 — `mermaid` 플러그인과 **정확히 같은 모양**이다.
 * 본문은 `escapeHtml` 로 `data-source` 에 넣고 런타임이 평문으로 다시 받는다.
 *
 * ⚠️ 다른 info-string 의 fence 는 원래 렌더러에 그대로 넘긴다. 여기서 가로채면
 * ` ```mermaid ` 이나 평범한 코드블록이 사라진다.
 */
export function lapisQueryPlugin(md: MarkdownIt): void {
  const orig = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, opts, env, slf) => {
    const token = tokens[idx];
    const info = (token.info || "").trim().toLowerCase();
    if (info === SAVED_QUERY_FENCE) {
      const src = md.utils.escapeHtml(token.content);
      return `<div class="lapis-query-host" data-source="${src}"></div>`;
    }
    return orig ? orig(tokens, idx, opts, env, slf) : slf.renderToken(tokens, idx, opts);
  };
}
