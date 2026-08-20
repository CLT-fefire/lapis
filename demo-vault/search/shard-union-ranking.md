---
title: shard union 랭킹
doc_kind: reference
topic: search-indexing
status: active
created: 2026-05-05
tags: [subject/search, architecture/shard-model]
related: [full-text-search-design]
---

# shard union 랭킹

인덱스를 여러 shard로 쪼개 워커에서 병렬로 세운다. 질의는 모든 shard에
던지고 점수 내림차순으로 합친다.

shard는 서로 겹치지 않는 문서 집합이라 union에 중복이 없다. 다만 점수가
shard 안의 통계로 계산되므로 shard 간 절대 비교는 엄밀하지 않다.
문서가 고르게 흩어져 있어 실용상 성립한다.

관련: [[full-text-search-design]] · [[index-cache-invalidation]]
