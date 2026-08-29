import type { ReadingPos } from "$lib/stores/readingPos";

/**
 * 최근 목록에 붙는 "읽던 자리" 표식.
 *
 * ## ⚠️ 아는 것만 말한다 — 퍼센트는 없다
 *
 * `ReadingPos` 는 `scroll`(px)과 `line` 만 안다. **문서 전체 길이를 모른다.** 진도를
 * 퍼센트로 내려면 그걸 어림해야 하는데, 어림한 진도는 틀려도 티가 안 난다 — 사람은
 * 숫자를 믿는다. 그래서 "자리가 있다/없다"와, 알 때만 줄 번호를 말한다.
 *
 * ## ⚠️ 맨 위는 자리가 아니다
 *
 * `rememberPos` 가 맨 위를 아예 안 저장하지만, 낡은 저장분이 들어올 수 있다. 표식이
 * 전부에 붙으면 아무것도 구별해 주지 못한다.
 */
export type ReadingMark = { kind: "preview" } | { kind: "editor"; line: number };

export function readingMarkFor(pos: ReadingPos | null): ReadingMark | null {
  if (!pos) return null;
  // 편집기 줄이 우선이다 — "1200px" 보다 "42줄"이 사람에게 뜻이 있다.
  if (pos.line !== undefined && pos.line > 1) return { kind: "editor", line: pos.line };
  if (pos.scroll > 0) return { kind: "preview" };
  return null;
}
