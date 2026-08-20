---
title: 풀텍스트 검색 설계
doc_kind: plan
topic: search-indexing
status: active
created: 2026-05-02
tags: [subject/search, tech/minisearch, architecture/shard-model]
related: [bm25-parameter-tuning, korean-bigram-tokenizer, shard-union-ranking]
---

# 풀텍스트 검색 설계

## 배경

노트가 만 건을 넘으면 파일명 검색만으로는 못 찾는다. 본문 인덱스를 따로 세우고
랭킹으로 답하는 층이 필요하다. 이 문서가 그 층의 단일 진실이다.

## 층 구분

- 파일명 fuzzy — 이름을 대략 알 때. 인덱스가 가볍고 키 입력마다 재계산한다.
- 본문 BM25 — 내용으로 찾을 때. 인덱스를 워커에서 세우고 디스크에 캐시한다.
- 문서 내 검색 — 열어둔 노트 안에서. 인덱싱과 무관하다.

## 결정

본문 인덱스는 [[korean-bigram-tokenizer]]로 토큰화하고 [[bm25-parameter-tuning]]의
계수를 쓴다. shard를 나눠 [[shard-union-ranking]]으로 합친다.
재구축 조건은 [[index-cache-invalidation]]에 있다.
