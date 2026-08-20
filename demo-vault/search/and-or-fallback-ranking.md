---
title: AND에서 OR로 내려가는 폴백
doc_kind: solution
topic: search-indexing
status: active
created: 2026-05-06
tags: [subject/search, issue/recall]
related: [full-text-search-design]
---

# AND에서 OR로 내려가는 폴백

## 증상

AND 결합만 쓰면 정확하지만, 정답 문서에 없는 단어가 하나 섞이면 결과가
0건이 된다. 사용자는 왜 안 나오는지 알 수가 없다.

## 처방

좁은 쪽부터 네 단계로 시도하고 결과가 나온 첫 단계에서 멈춘다.
단어 하나를 뺀 AND, 그다음 매칭 비율 하한을 둔 OR, 마지막이 순수 OR다.
어느 단계에서 나왔는지를 응답에 실어 소비자가 신뢰도를 판단하게 한다.

관련: [[full-text-search-design]]
