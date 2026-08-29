import { noteStem } from "$lib/notePath";

/**
 * 헤딩으로 가는 **위키링크 문자열**.
 *
 * `[[노트#헤딩]]` 앵커는 이미 동작한다(`headingAnchor` · `resolveHeadingAnchor`).
 * 없던 것은 **그 링크를 만드는 방법**이었다 — 손으로 적으면 헤딩 글자를 옮겨 적어야 하고,
 * 한 글자만 달라도 조용히 문서 맨 위로 간다.
 *
 * ## ⚠️ 링크를 깨는 글자들
 *
 * 헤딩에 `]]` · `|` · `#` 가 들어 있으면 위키링크 문법이 **거기서 끊긴다.** 에러는 안 나고
 * 엉뚱한 자리로 가거나 아예 안 걸린다. 그래서 링크를 만들 수 없는 헤딩은 `null` 을 낸다 —
 * **깨진 링크를 주는 것보다 안 주는 것이 낫다.**
 */

/** 위키링크 안에서 뜻이 갈리는 글자들. */
const BREAKS_LINK = /\]\]|\|/;

/**
 * `[[노트#헤딩]]` 을 만든다. 만들 수 없으면 `null`.
 *
 * @param notePath 지금 노트의 경로. 확장자와 폴더는 뗀다 — 위키링크는 이름으로 건다.
 * @param headingText 헤딩 **글자 그대로**. `slugify` 는 해소하는 쪽이 한다.
 */
export function headingLinkFor(notePath: string, headingText: string): string | null {
  const name = noteStem(notePath).trim();
  const heading = headingText.trim();
  if (!name || !heading) return null;
  // ⚠️ `#` 는 헤딩 구분자다. 헤딩 글자에 또 있으면 어디서 끊길지 알 수 없다.
  if (BREAKS_LINK.test(name) || BREAKS_LINK.test(heading) || heading.includes("#")) return null;
  if (name.includes("#")) return null;
  return `[[${name}#${heading}]]`;
}
