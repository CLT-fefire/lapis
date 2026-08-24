/**
 * 검색 스니펫이 **랭킹과 같은 것을 찾는지** 고정한다.
 *
 * ## 왜 이 테스트가 있나
 *
 * 랭킹은 `koBigramTokenize`로 찾고, 스니펫은 질의 전체를 `indexOf`로만 찾았다.
 * **매처가 둘이었고 서로 어긋났다.** 조사·어미가 다른 질의(= bigram 인덱스의 존재
 * 이유 그 자체)는 랭킹이 문서를 찾아내도 스니펫이 매치를 못 찾아 `matched=false`로
 * 떨어졌고, 폴백이 본문 앞 120자를 냈다. 규약상 모든 노트가 frontmatter로 시작하므로
 * 그 120자는 **항상 YAML 덤프**였다.
 *
 * 결과적으로 앱이 가장 잘하는 상황에서 스니펫이 가장 쓸모없었다. 2026-08-20 데모
 * vault 스크린샷을 찍다가 드러났다 — 결과 10건의 스니펫이 전부 `--- title: … doc_kind: …`.
 */

import { describe, expect, it } from "vitest";
import { snippetForQuery, extractSnippetAround } from "$lib/snippet";

const NOTE = `---
title: 한국어 bigram 토크나이저
doc_kind: adr
topic: search-indexing
status: active
tags: [subject/search, issue/recall]
---

# 한국어 bigram 토크나이저

한국어는 조사와 어미가 붙는다. 공백으로만 쪼개면 인덱스를 찾을 때 형태가 어긋난다.
그래서 2글자 bigram으로 쪼갠다.
`;

describe("snippetForQuery", () => {
  it("조사가 다른 질의도 매치 문맥을 낸다 — 랭킹과 같은 토크나이저", () => {
    // `인덱스로`는 본문에 없다. 있는 건 `인덱스를`이고, bigram 2/3이 겹쳐 랭킹은 찾아낸다.
    const s = snippetForQuery(NOTE, "인덱스로");
    expect(s).toContain("인덱스를");
    expect(s).not.toContain("doc_kind");
  });

  it("frontmatter는 발췌 대상이 아니다", () => {
    // 질의어가 frontmatter에만 있어도 본문 밖으로 나가지 않는다.
    const s = snippetForQuery(NOTE, "doc_kind");
    expect(s).not.toContain("doc_kind:");
  });

  it("어절이 그대로 있으면 그 위치를 쓴다", () => {
    const s = snippetForQuery(NOTE, "인덱스를");
    expect(s).toContain("인덱스를");
  });

  it("아무것도 안 맞으면 본문 앞부분 — 단, frontmatter는 아니다", () => {
    const s = snippetForQuery(NOTE, "zzzz존재하지않는질의zzzz");
    expect(s).not.toContain("title:");
    expect(s).toContain("한국어 bigram 토크나이저");
  });

  it("frontmatter가 없는 노트도 그대로 동작한다", () => {
    const s = snippetForQuery("그냥 본문이다. 인덱스를 세운다.", "인덱스로");
    expect(s).toContain("인덱스를");
  });
});

describe("extractSnippetAround", () => {
  it("매치가 없으면 matched=false — 폴백 결정은 호출자 몫", () => {
    expect(extractSnippetAround("본문", ["없음"]).matched).toBe(false);
  });
});
