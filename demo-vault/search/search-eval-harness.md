---
title: 검색 품질 계측 장치
doc_kind: plan
topic: search-indexing
status: active
created: 2026-05-10
tags: [subject/search, tech/vitest]
related: [bm25-parameter-tuning, recall-vs-precision]
---

# 검색 품질 계측 장치

## 목적

랭킹 변경을 감으로 판단하지 않기 위한 장치다. 질의와 정답 문서 쌍을 모아
상위 정확도와 평균 순위를 낸다.

## 함정

장치 자체가 조용히 죽으면 통과로 읽힌다. 일부러 틀린 인덱스를 물려
실패가 찍히는지 확인하고 나서 신뢰한다.
