import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

/**
 * 작업 목록 — `- [ ]` · `- [x]` 를 **체크박스로** 그린다.
 *
 * ## ⚠️ 왜 필요했나 (2026-08-28 실측)
 *
 * markdown-it 코어에는 작업 목록이 없다. 그래서 `- [ ] 할 일` 이 **글자 그대로**
 * `[ ] 할 일` 로 보였다. 이 vault 에는 **미완 90 · 완료 30** 이 5노트에 흩어져 있다 —
 * 적지 않은데 전부 대괄호로 보이고 있었다.
 *
 * ## ⚠️ 읽기 전용이다
 *
 * 체크박스는 `disabled` 다. `README` 가 "쓰기 도구가 아니다"라고 못 박았고, 클릭으로
 * 파일을 고치는 것은 **되돌릴 수 없는 쓰기**다 — 그건 편집기(`⌘E`)의 몫이다.
 *
 * 눌러도 아무 일이 없으면 고장처럼 보이므로 `title` 로 이유를 남긴다.
 *
 * ## ⚠️ 원문을 지우지 않는다
 *
 * 토큰의 내용에서 `[ ]` 만 걷어내고 나머지는 그대로 둔다. 인라인 토큰을 새로 만들면
 * 그 안의 위키링크·강조가 **한 번 더 파싱되거나 아예 안 된다** — 둘 다 조용히 틀린다.
 */

const TASK = /^\[([ xX])\]\s+/;

export function taskListPlugin(md: MarkdownIt): void {
  md.core.ruler.after("inline", "lapis_task_list", (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "inline") continue;

      // 이 인라인이 리스트 항목의 첫 문단인가 — `list_item_open > paragraph_open > inline`.
      const pOpen = tokens[i - 1];
      const liOpen = tokens[i - 2];
      if (!pOpen || pOpen.type !== "paragraph_open") continue;
      if (!liOpen || liOpen.type !== "list_item_open") continue;

      const inline = tokens[i];
      const first = inline.children?.[0];
      if (!first || first.type !== "text") continue;

      const m = TASK.exec(first.content);
      if (!m) continue;

      const checked = m[1] !== " ";
      // ⚠️ 원문에서 `[ ]` 만 걷는다. 나머지 children 은 손대지 않는다.
      first.content = first.content.slice(m[0].length);

      const box = new state.Token("html_inline", "", 0);
      box.content =
        `<input class="task-checkbox" type="checkbox" disabled` +
        `${checked ? " checked" : ""} title="읽기 전용 — 편집은 ⌘E" />`;
      inline.children!.unshift(box);

      // 목록 자체의 불릿을 지우기 위한 표시. CSS 가 이걸 본다.
      liOpen.attrJoin("class", "task-item");
      const ulOpen = findListOpen(tokens, i - 2);
      if (ulOpen) ulOpen.attrJoin("class", "task-list");
    }
    return true;
  });
}

const isListOpen = (t: Token) => t.type === "bullet_list_open" || t.type === "ordered_list_open";
const isListClose = (t: Token) => t.type === "bullet_list_close" || t.type === "ordered_list_close";

/**
 * 이 `list_item_open` 을 담은 목록 토큰. 못 찾으면 `null`.
 *
 * ⚠️ **번호 목록도 본다.** 불릿만 보던 때는 `1. [ ] 할 일` 에서 `.task-item` 만 붙고
 * `.task-list` 가 안 붙어, 그 항목만 들여쓰기가 어긋난 채 조용히 지나갔다.
 */
function findListOpen(tokens: readonly Token[], liIndex: number): Token | null {
  let depth = 0;
  for (let i = liIndex - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t.type === "list_item_close") depth++;
    else if (t.type === "list_item_open") {
      if (depth === 0) continue;
      depth--;
    } else if (isListOpen(t) && depth === 0) {
      return t;
    } else if (isListClose(t)) {
      depth++;
    }
  }
  return null;
}
