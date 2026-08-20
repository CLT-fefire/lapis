---
title: 재현율과 정확도의 교환
doc_kind: reference
topic: search-indexing
status: active
created: 2026-05-11
tags: [subject/search, issue/recall]
related: [search-eval-harness]
---

# 재현율과 정확도의 교환

정규식 검색은 재현율이 100%다. 어휘가 정확히 맞으면 다 찾는다. 대신 순위가
없어 결과가 많으면 사람이 다시 골라야 한다.

인덱스를 세워 랭킹을 붙이면 재현율은 조금 떨어지고 상위 정확도가 올라간다.
둘은 대체 관계가 아니라 상황에 따라 갈라 쓰는 도구다.
