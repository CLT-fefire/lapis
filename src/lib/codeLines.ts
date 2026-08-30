import MarkdownIt from "markdown-it";

/**
 * **본문에서 어느 줄이 코드인가** — 이 규칙이 사는 유일한 자리.
 *
 * ## 🔴 왜 모았나 (2026-08-30 실측)
 *
 * 같은 질문에 세 곳이 다르게 답하고 있었다:
 *
 * | 어디 | 방식 | 놓친 것 |
 * |---|---|---|
 * | `linkRewrite.ts` | **markdown-it 블록 파스** | (없음) — 다만 비공개였다 |
 * | `openTasks.ts` | 줄 단위 토글 | **들여쓴 코드블록** |
 * | `vaultAudit.ts` 의 `maskNonProse` | 정규식 | **`~~~` 펜스 · 들여쓴 코드블록** |
 *
 * ⚠️ 맞는 답이 이미 있었다. `linkRewrite.ts` 주석이 *"naive `startsWith("\`\`\`")` 토글이
 * 놓치던 들여쓰기 코드블록·인용 내부 펜스도 정확히 포함"* 이라고 적어 두었는데,
 * **그 교훈이 그 파일 밖으로 안 나갔다.** 노트 확장자 때와 같은 모양이다.
 *
 * ## ⚠️ 왜 정규식으로 못 하나
 *
 * **들여쓰기 네 칸이 코드인지 아닌지는 문맥이 정한다.**
 *
 * ```md
 * - [ ] 부모
 *     - [ ] 자식        ← 리스트 계속. 코드가 아니다
 *
 * 그냥 문단
 *
 *     - [ ] 예시         ← 들여쓴 코드블록. 코드다
 * ```
 *
 * 두 줄의 생김새가 같다. 그래서 "네 칸이면 코드"로 고치면 **중첩 할 일이 통째로 죽는다.**
 * 블록 파서만 이 둘을 가른다.
 *
 * ## 비용 (139노트 · 607 KB 실측)
 *
 * | | |
 * |---|---:|
 * | 줄 토글로 전체 훑기 | 1.6 ms |
 * | markdown-it 로 전체 훑기 | 29.3 ms |
 * | markdown-it 로 **후보만** (8노트, 6%) | 3.3 ms |
 *
 * 그래서 부르는 쪽이 **먼저 값싸게 거르고** 후보에만 이걸 쓴다. 전량 파스는 18배다.
 */

// 렌더는 하지 않는다 — 블록 토큰의 map(줄 범위)만 쓴다.
const codeMd = new MarkdownIt({ html: false });

/**
 * 코드 블록(fence · 들여쓰기)에 속한 **0-based 줄 번호** 집합.
 *
 * ⚠️ 인라인 코드(`` `x` ``)는 **여기 없다.** 줄 단위가 아니라서다 — 필요한 쪽이 따로 덮는다.
 */
export function codeBlockLines(body: string): Set<number> {
  const set = new Set<number>();
  for (const tok of codeMd.parse(body, {})) {
    // token.map 은 [시작, 끝) — 끝은 제외다.
    if ((tok.type === "fence" || tok.type === "code_block") && tok.map) {
      for (let i = tok.map[0]; i < tok.map[1]; i++) set.add(i);
    }
  }
  return set;
}

/**
 * 코드 블록 줄을 **같은 길이의 공백으로** 덮는다.
 *
 * 🔴 **길이를 보존한다.** 잘라내면 줄 번호와 오프셋이 어긋나고, 그러면 찾은 자리를
 * 사용자에게 보여줄 때 엉뚱한 줄을 가리킨다. 예외는 안 나고 결과만 그럴듯하게 틀린다.
 */
export function blankCodeBlocks(body: string): string {
  const code = codeBlockLines(body);
  if (code.size === 0) return body;
  return body
    .split("\n")
    .map((line, i) => (code.has(i) ? line.replace(/[^\n]/g, " ") : line))
    .join("\n");
}
