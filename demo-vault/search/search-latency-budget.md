---
title: 검색 지연 예산
doc_kind: reference
topic: search-indexing
status: active
created: 2026-05-16
tags: [subject/search, issue/latency]
related: [and-or-fallback-ranking]
---

# 검색 지연 예산

키 입력마다 질의하면 긴 질의에서 비용이 폭발한다. 입력이 멈춘 뒤 한 번만
실행하고, 앞선 질의는 취소해 늦게 도착한 결과가 새 결과를 덮지 않게 한다.

폴백 단계에도 상한을 둔다. 어절이 많으면 중간 단계를 건너뛴다 —
품질을 조금 깎는 대신 지연을 크게 줄인다.

관련: [[full-text-search-design]]
