---
title: 인덱스 캐시 무효화
doc_kind: solution
topic: search-indexing
status: active
created: 2026-05-07
tags: [subject/search, issue/stale-cache, architecture/index-rebuild]
related: [full-text-search-design, shard-union-ranking]
---

# 인덱스 캐시 무효화

## 문제

토크나이저를 바꾸면 인덱스의 토큰 공간이 바뀐다. 예전 캐시를 그대로 읽으면
에러 없이 랭킹만 조용히 달라진다. 이게 가장 잡기 어려운 종류의 회귀다.

## 처방

캐시에 버전을 박고 토크나이저 변경 시 올린다. 버전이 다르면 인덱스를
통째로 다시 세운다. 조용한 오작동보다 느린 재구축이 낫다.
