---
title: BM25 계수 조정
doc_kind: solution
topic: search-indexing
status: active
created: 2026-05-04
tags: [subject/search, tech/minisearch]
related: [full-text-search-design, search-eval-harness]
---

# BM25 계수 조정

## 계측

길이 보정 계수를 기본값에서 낮추자 상위 정확도가 올랐다. 짧은 노트가
과대평가되던 문제가 줄었다. 인덱스를 다시 세우지 않아도 되는 변경이다.

| 설정 | R@1 | R@10 |
|---|---:|---:|
| 기본 | 71.9% | 89.5% |
| 조정 후 | 72.5% | 90.1% |

계측 방법은 [[search-eval-harness]]에 있다.
