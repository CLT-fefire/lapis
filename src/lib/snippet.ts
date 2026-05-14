/**
 * 본문에서 매칭어 주변 ±radius 글자 발췌. 백링크 컨텍스트와 풀텍스트 검색이 공유.
 *
 * - terms 배열의 각 항목을 indexOf로 검사, 가장 빠른 위치 사용
 * - 매칭 없으면 matched=false. 호출자가 fallback 메시지를 결정 (이 함수는 빈 스니펫 반환)
 * - 줄바꿈·중복 공백은 단일 스페이스로 정규화
 */
export interface SnippetResult {
  snippet: string;
  matched: boolean;
}

export function extractSnippetAround(
  body: string,
  terms: string[],
  radius = 60,
): SnippetResult {
  if (!body) return { snippet: "", matched: false };
  const lower = body.toLowerCase();
  let bestIdx = -1;
  for (const t of terms) {
    if (!t) continue;
    const i = lower.indexOf(t.toLowerCase());
    if (i !== -1 && (bestIdx === -1 || i < bestIdx)) bestIdx = i;
  }
  if (bestIdx === -1) {
    return { snippet: "", matched: false };
  }
  const start = Math.max(0, bestIdx - radius);
  const end = Math.min(body.length, bestIdx + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  return {
    snippet: prefix + body.slice(start, end).replace(/\s+/g, " ").trim() + suffix,
    matched: true,
  };
}
