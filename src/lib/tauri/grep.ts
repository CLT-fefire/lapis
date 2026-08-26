import { invoke } from "@tauri-apps/api/core";

/**
 * vault 전체 정규식·리터럴 검색 — Rust `grep_vault`의 타입드 래퍼.
 *
 * BM25(`⌘⇧F`)가 **토큰**을 찾는다면 이쪽은 **문자열**을 찾는다. 어휘가 어긋나
 * ("창" vs "윈도우") BM25가 못 닿는 구간을 메우는 팔이다 — `mcp/README.md`의
 * grep 비교가 "둘 다 쓰는 게 맞다"고 결론낸 그 이유다.
 */

export interface GrepHit {
  /** 노트 절대 경로. Rust가 `/` 구분자로 정규화해 보낸다. */
  path: string;
  /** 1-based 줄 번호. */
  line: number;
  /** 매치가 있는 줄. 길면 매치 주변만 잘려 온다(`clipped`). */
  text: string;
  /**
   * `text` 안에서의 매치 시작 — **UTF-16 코드 단위**라 JS 문자열 인덱스로 그대로 쓴다.
   *
   * ⚠️ 프런트에서 패턴을 다시 돌려 위치를 구하지 않는다. Rust `regex`는 역참조·lookaround가
   * 없어 JS `RegExp`와 매치 지점이 다를 수 있다.
   */
  col: number;
  /** 매치 길이 — UTF-16 코드 단위. 잘린 창 밖으로 넘어가면 보이는 만큼만. */
  len: number;
  /** 원본 줄이 잘렸나. 생략 표시의 근거. */
  clipped: boolean;
}

export interface GrepResult {
  hits: GrepHit[];
  /** 매치가 나온 파일 수. */
  files: number;
  /** 훑기 대상이던 파일 수. */
  scanned: number;
  /** 상한에 걸려 조기 종료했나. */
  truncated: boolean;
}

export interface GrepOptions {
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  limit?: number;
}

/**
 * ⚠️ 실패를 삼키지 않는다. 잘못된 정규식은 Rust가 에러로 돌려주고 호출부가 그걸
 * 그대로 보여준다 — 문서 내 검색(`inDocSearch`)이 `regexError`로 하는 것과 같다.
 */
export function grepVault(
  vaultPath: string,
  pattern: string,
  opts: GrepOptions,
): Promise<GrepResult> {
  return invoke<GrepResult>("grep_vault", {
    vaultPath,
    pattern,
    regex: opts.regex,
    caseSensitive: opts.caseSensitive,
    wholeWord: opts.wholeWord,
    limit: opts.limit ?? null,
  });
}
