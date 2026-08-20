---
title: 구조 팔의 어휘 문제
doc_kind: solution
topic: search-indexing
status: active
created: 2026-05-17
tags: [subject/search, subject/tags, issue/recall]
related: [tag-hierarchy-design]
---

# 구조 팔의 어휘 문제

## 노렸던 것

짧은 질의에 풀텍스트만 들이대지 말고 태그와 속성 후보를 함께 내주려 했다.

## 실측

효과가 없었다. 태그와 속성 어휘가 전부 영문인데 질의가 한국어라 둘이
만나지 못한다. 랭킹 문제가 아니라 어휘 집합이 겹치지 않는 문제다.
영문 질의에는 잘 듣는다. [[tag-hierarchy-design]] 참조.
