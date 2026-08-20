---
title: 질의 정규화
doc_kind: reference
topic: search-indexing
status: active
created: 2026-05-13
tags: [subject/search, tech/minisearch]
related: [korean-bigram-tokenizer]
---

# 질의 정규화

인덱스를 세울 때와 질의할 때 정규화가 어긋나면 매칭이 조용히 실패한다.
역직렬화한 인덱스에도 같은 토크나이저와 정규화를 명시적으로 물려야 한다.
기본값에 기대면 캐시에서 되살린 인덱스가 다르게 동작한다.

관련: [[full-text-search-design]]
