import type MarkdownIt from "markdown-it";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";

/**
 * 콜아웃 — `> [!WARNING]` 으로 시작하는 인용문.
 *
 * ## ⚠️ GitHub의 다섯 종만 받는다
 *
 * Obsidian은 `info`·`success`·`question`·`bug`… 열둘 넘게 받지만 **여기서는 안 받는다.**
 * 이 vault의 문서는 GitHub에서도 읽히고(저장소가 공개다), 교집합 밖의 종류를 쓰면
 * 한쪽에서만 뜬다. 두 곳에서 같아 보이는 것이 종류가 많은 것보다 값지다.
 *
 * 모르는 종류는 **콜아웃으로 만들지 않는다.** 평범한 인용문으로 남으면 `[!QUESTION]`
 * 글자가 그대로 보여서, 쓴 사람이 왜 안 먹었는지 바로 안다. 조용히 삼키면 모른다.
 *
 * ## 왜 core 룰인가
 *
 * 인용문은 **블록**이라 인라인 룰로는 못 잡는다. 이미 파싱이 끝난 토큰 열에서
 * `blockquote_open` 다음의 첫 문단을 들여다보고, 표식이면 토큰을 바꿔치기한다.
 * 블록 룰을 새로 쓰지 않는 이유는 **인용문 안의 마크다운을 그대로 살리기 위해서**다 —
 * markdown-it이 이미 다 해 놨다.
 *
 * ⚠️ 코드 펜스 안은 애초에 토큰이 `fence` 하나라 여기 안 걸린다. 따로 막을 필요가 없다.
 */

/** GitHub alert 다섯 종. **이 순서가 GitHub 문서의 순서다.** */
export const CALLOUT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;

export type CalloutKind = (typeof CALLOUT_KINDS)[number];

const KINDS = new Set<string>(CALLOUT_KINDS);

/** 표식 줄 — 문단 첫 줄이어야 한다. 뒤에 붙는 나머지는 제목이다. */
const MARKER = /^\[!([A-Za-z]+)\]([^\n]*)/;

/** `note` → `Note`. 제목을 안 적었을 때 쓰는 기본 제목. */
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function calloutPlugin(md: MarkdownIt): void {
  md.core.ruler.push("lapis_callout", (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i].type !== "blockquote_open") continue;
      if (tokens[i + 1].type !== "paragraph_open") continue;
      const inline = tokens[i + 2];
      if (inline.type !== "inline") continue;

      const m = MARKER.exec(inline.content);
      if (!m) continue;
      const kind = m[1].toLowerCase();
      // ⚠️ 모르는 종류는 그대로 둔다 — 위 주석 참조.
      if (!KINDS.has(kind)) continue;

      const title = m[2].trim() || titleCase(kind);
      tokens[i].attrJoin("class", `callout callout-${kind}`);

      // 표식 줄을 본문에서 걷어내고 제목 토큰으로 바꾼다.
      const rest = inline.content.slice(m[0].length).replace(/^\n/, "");
      inline.content = rest;
      // ⚠️ **다시 토큰화한다.** 인라인 토큰은 `content`가 아니라 `children`으로 그려진다 —
      //    `content`만 고치고 `children`을 비우면 본문이 통째로 사라진다(실제로 그랬다).
      inline.children = [];
      state.md.inline.parse(rest, state.md, state.env, inline.children);

      const open = new state.Token("callout_title_open", "div", 1);
      open.attrSet("class", "callout-title");
      const text = new state.Token("text", "", 0);
      text.content = title;
      const close = new state.Token("callout_title_close", "div", -1);
      tokens.splice(i + 1, 0, open, text, close);

      // ⚠️ 표식만 있고 본문이 없으면 빈 `<p>`가 남는다. 그건 지운다.
      if (rest.trim() === "") {
        const pOpen = i + 4;
        if (tokens[pOpen]?.type === "paragraph_open") tokens.splice(pOpen, 3);
      }
      i += 3;
    }
  });
}
