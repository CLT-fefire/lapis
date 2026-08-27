import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

/**
 * `![[노트]]` · `![[노트#헤딩]]` → **자리표시자**.
 *
 * ⚠️ 여기서 내용을 채우지 않는다. 다른 노트를 읽어야 하는데 markdown-it은 동기이고,
 * 앱에서 노트를 읽는 것은 IPC(비동기)다. 그래서 자리만 만들고 **채우는 것은 표면의 몫**이다
 * (앱은 렌더 후 effect, CLI는 문자열 치환). 규칙은 `$lib/embed.ts` 한 곳에 있다.
 *
 * ⚠️ **`wikilink` 룰보다 먼저 등록해야 한다.** `![[x]]` 안에 `[[x]]` 가 들어 있어서,
 * 순서가 뒤집히면 `!` 는 글자로 남고 나머지가 평범한 위키링크가 된다 — 임베드가
 * **조용히 링크로 바뀐다.**
 */

const BANG = 0x21; // !
const OPEN = 0x5b; // [

export function embedPlugin(md: MarkdownIt): void {
  md.inline.ruler.before("wikilink", "wikiembed", (state: StateInline, silent: boolean) => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== BANG) return false;
    if (state.src.charCodeAt(start + 1) !== OPEN) return false;
    if (state.src.charCodeAt(start + 2) !== OPEN) return false;

    const close = state.src.indexOf("]]", start + 3);
    if (close === -1) return false;
    const inner = state.src.slice(start + 3, close);
    if (inner.includes("\n") || inner.includes("[[")) return false;

    if (!silent) {
      // 별칭은 표시 텍스트라 임베드에는 뜻이 없다 — 버린다.
      const pipe = inner.indexOf("|");
      const ref = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
      if (!ref) return false;
      const hash = ref.indexOf("#");
      const token = state.push("wikiembed", "", 0);
      token.meta = {
        target: (hash === -1 ? ref : ref.slice(0, hash)).trim(),
        anchor: hash === -1 ? null : ref.slice(hash + 1).trim(),
      };
    }

    state.pos = close + 2;
    return true;
  });

  md.renderer.rules.wikiembed = (tokens, idx) => {
    const meta = tokens[idx].meta as { target: string; anchor: string | null };
    const t = md.utils.escapeHtml(meta.target);
    const a = meta.anchor === null ? "" : ` data-embed-anchor="${md.utils.escapeHtml(meta.anchor)}"`;
    // ⚠️ 자리표시자 안에 **원문을 남긴다.** 채우기가 안 돌면 빈 네모가 아니라
    //    `![[노트]]` 가 보여서, 무엇이 안 됐는지 바로 안다.
    const raw = md.utils.escapeHtml(
      `![[${meta.target}${meta.anchor === null ? "" : `#${meta.anchor}`}]]`,
    );
    return `<div class="embed" data-embed-target="${t}"${a}>${raw}</div>`;
  };
}
