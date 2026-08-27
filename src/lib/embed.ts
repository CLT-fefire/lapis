import { slugify, type HeadingInfo } from "$lib/markdownPlugins/headingAnchor";

/**
 * 트랜스클루전 — `![[노트]]` · `![[노트#헤딩]]`.
 *
 * ## ⚠️ 규칙은 여기 한 곳에, 순회는 표면마다
 *
 * 앱은 **DOM을 훑고**(렌더 후 자리표시자를 채운다), CLI는 **문자열을 훑는다**(브라우저가
 * 없다). 순회를 하나로 합치려면 한쪽이 자기 사정을 버려야 해서 갈라 뒀다.
 *
 * 대신 **판단은 전부 여기 있다** — 깊이 상한 · 순환 · 실패했을 때 무엇을 보여줄지.
 * 이게 갈리면 같은 문서가 앱과 CLI에서 다르게 보인다.
 */

/**
 * 임베드를 몇 겹까지 따라가나.
 *
 * ⚠️ 순환은 따로 막지만(아래) **깊이 상한도 필요하다.** 순환이 아니어도 A→B→C→D…가
 * 길어지면 문서 하나를 여는 데 수십 개를 읽는다. 3겹이면 "요약이 조각을 당겨오고 그
 * 조각이 또 하나를 당겨오는" 정도까지는 된다.
 */
export const EMBED_MAX_DEPTH = 3;

export type EmbedFailure = "unresolved" | "cycle" | "too-deep" | "no-section";

/**
 * 임베드가 안 됐을 때 **자리에 남기는 것**.
 *
 * ⚠️ 빈 자리로 두지 않는다. 임베드는 본문의 일부라 사라지면 **문장이 끊긴 것을 눈치채기
 * 어렵다** — 원래 거기 뭐가 있었는지 모르니까. 무엇을 못 가져왔는지 이름을 남긴다.
 */
export function embedFailureText(kind: EmbedFailure, target: string): string {
  switch (kind) {
    case "unresolved":
      return `임베드할 노트를 못 찾았다: ${target}`;
    case "cycle":
      return `임베드가 자기 자신으로 돌아온다: ${target}`;
    case "too-deep":
      return `임베드가 ${EMBED_MAX_DEPTH}겹을 넘었다: ${target}`;
    case "no-section":
      return `그 헤딩이 없다: ${target}`;
  }
}

/**
 * 앵커가 가리키는 **구간만** 잘라낸다 — 그 헤딩부터 같거나 더 높은 레벨의 다음 헤딩 앞까지.
 *
 * ⚠️ 헤딩 줄 자체를 포함한다. 빼면 잘라온 조각에 제목이 없어서 어디서 왔는지 모른다.
 *
 * ⚠️ `headings[].line` 은 **원본 raw 기준 0-based** 다(`parseNote`가 frontmatter 줄 수를
 * 이미 보정해서 준다). 그래서 여기 들어오는 `body`도 **frontmatter를 뗀 본문**이어야 한다 —
 * 어긋나면 엉뚱한 줄부터 잘라오고, 결과는 그럴듯한 텍스트라 아무도 못 알아챈다.
 */
export function sliceSection(
  body: string,
  headings: readonly HeadingInfo[],
  anchor: string,
): string | null {
  const want = slugify(anchor);
  const idx = headings.findIndex((h) => h.slug === want);
  if (idx === -1) return null;
  const start = headings[idx];
  const next = headings.slice(idx + 1).find((h) => h.level <= start.level);
  const lines = body.split("\n");
  return lines.slice(start.line, next ? next.line : lines.length).join("\n").trimEnd();
}

/** `![[노트#헤딩]]` 안쪽 문자열에서 대상과 앵커를 가른다. 별칭(`|`)은 표시용이라 버린다. */
export interface EmbedRef {
  target: string;
  anchor: string | null;
}

/**
 * 이 체인에서 이미 지나온 노트인가.
 *
 * ⚠️ **체인 기준이지 전역 기준이 아니다.** 한 문서가 같은 노트를 두 군데서 임베드하는 것은
 * 정상이다 — 전역으로 막으면 두 번째가 조용히 빈다.
 */
export function isCycle(chain: readonly string[], path: string): boolean {
  return chain.includes(path);
}
