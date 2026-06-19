/**
 * 한글 bigram 하이브리드 토크나이저 — 풀텍스트 검색용 (검색 언어 = 한국어 + 영어).
 *
 * 한글 음절 런은 **겹치는 bigram(2글자)** 으로, 그 외(영어/식별자/숫자)는 **단어 단위**로 쪼갠다.
 * MiniSearch 기본 토크나이저(공백/구두점 split)는 한글 어절을 통째로 토큰화해 "정보검색을"
 * 안의 "검색"을 prefix로도 못 잡는다. bigram은 합성어·어미변형 substring을 매칭한다
 * (Lucene cjk_bigram·MySQL ngram이 CJK에 쓰는 표준 기법; 대상 언어가 한국어+영어뿐이라 한글만 bigram).
 *
 * ⚠️ **index·query 양쪽에서 동일하게 적용돼야 매칭됨** — `fullTextWorker` FULLTEXT_OPTIONS의
 * `tokenize`와 `searchOptions.tokenize` 모두에 지정한다. 이 로직을 바꾸면 인덱스 호환이 깨지므로
 * `search_cache.rs`의 `CACHE_VERSION`을 bump해 기존 캐시를 무효화해야 한다.
 *
 * 한계: 한글 1글자 쿼리는 bigram 토큰(2글자)과 매칭되지 않는다(너무 광범위해 실익 적음).
 */

/** 한글 음절(U+AC00–U+D7A3) 한 글자인가. 음절은 BMP 단일 코드유닛이라 charCodeAt로 충분. */
function isHangulSyllable(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c >= 0xac00 && c <= 0xd7a3;
}

/** 공백·구두점·기호 분리자(유니코드). */
const SEPARATOR = /[\s\p{P}\p{S}]+/u;

/**
 * 토큰화: 분리자로 1차 split → 각 토큰을 한글 런/비한글 런으로 나눠 한글만 bigram.
 * 예: "정보검색API" → ["정보","보검","검색","API"], "검색의" → ["검색","색의"].
 */
export function koBigramTokenize(text: string): string[] {
  const out: string[] = [];
  for (const word of text.split(SEPARATOR)) {
    if (!word) continue;
    let i = 0;
    const n = word.length;
    while (i < n) {
      const hangul = isHangulSyllable(word[i]);
      let j = i + 1;
      while (j < n && isHangulSyllable(word[j]) === hangul) j++;
      const run = word.slice(i, j);
      if (hangul) {
        if (run.length === 1) out.push(run); // 1글자 음절은 그대로(드묾)
        else for (let k = 0; k + 2 <= run.length; k++) out.push(run.slice(k, k + 2));
      } else {
        out.push(run); // 영어/숫자/식별자는 단어 통째 (소문자화는 normalizeTerm이 담당)
      }
      i = j;
    }
  }
  return out;
}

/** 인덱스·쿼리 공통 term 정규화 — NFC(macOS 자모 분리형 방어) + 소문자. */
export function normalizeTerm(term: string): string {
  return term.normalize("NFC").toLowerCase();
}
