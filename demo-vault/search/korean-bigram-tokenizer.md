---
title: 한국어 bigram 토크나이저
doc_kind: adr
topic: search-indexing
status: active
created: 2026-05-03
tags: [subject/search, issue/recall, tech/minisearch]
related: [full-text-search-design]
---

# 한국어 bigram 토크나이저

## 문제

한국어는 조사와 어미가 붙는다. 공백으로만 쪼개면 `인덱스를`과 `인덱스가`가
다른 토큰이 되고, 질의에 조사를 붙인 사용자는 아무것도 못 찾는다.

## 선택

형태소 분석기를 붙이지 않고 2글자 bigram으로 쪼갠다. `인덱스를`은
`인덱`·`덱스`·`스를`이 되고 `인덱스가`는 `인덱`·`덱스`·`스가`가 된다.
앞의 두 개가 겹치므로 조사가 달라도 매칭이 살아남는다.

## 대가

토큰 수가 늘어 인덱스가 커진다. 형태소 분석기보다 정밀도는 낮지만
사전 관리와 런타임 의존성이 없다. [[full-text-search-design]] 참조.
