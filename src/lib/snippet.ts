import { splitFrontmatter } from "$lib/frontmatter";
import { koBigramTokenize, normalizeTerm } from "$lib/koTokenize";

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

/**
 * 검색 결과 행에 붙일 스니펫 — **원문 → 표시 문자열**까지의 순수 변환.
 *
 * IO(readNote)는 호출자가 맡는다. 이 함수가 leaf인 이유는 `fullTextOptions`와 같다 —
 * Node 테스트에서 그대로 import 되어야 랭킹/스니펫의 어긋남을 고정할 수 있다.
 *
 * 세 단계로 내려간다:
 *
 * 1. **frontmatter 제외** — 규약상 모든 노트가 같은 키로 시작한다. 두면 매치 위치와
 *    무관하게 스니펫이 전부 YAML 덤프로 수렴한다.
 * 2. **질의 어절 그대로** — 그 형태가 본문에 있으면 이게 가장 좋은 위치다.
 * 3. **랭킹과 같은 토크나이저(bigram)** — 조사·어미가 달라 어절이 어긋나는 경우가
 *    bigram 인덱스의 존재 이유 그 자체다. 여기서 놓치면 검색이 찾아낸 문서를 두고
 *    "왜 걸렸는지"를 못 보여준다 (질의 `인덱스로` → 본문 `인덱스를`).
 *
 * ⚠️ 2·3이 **서로 다른 매처**라는 게 원래 결함이었다. 랭킹은 bigram으로 찾는데 스니펫은
 * 질의 전체를 `indexOf`로만 찾아, 매치가 없으면 본문 앞 120자(= frontmatter)를 냈다.
 */
export function snippetForQuery(raw: string, query: string, radius = 60): string {
  const body = splitFrontmatter(raw).body;
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let hit = extractSnippetAround(body, words, radius);
  if (!hit.matched) {
    hit = extractSnippetAround(body, koBigramTokenize(query).map(normalizeTerm), radius);
  }
  return hit.matched
    ? hit.snippet
    : body.slice(0, radius * 2).replace(/\s+/g, " ").trim() + "…";
}
