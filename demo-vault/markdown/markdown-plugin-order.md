---
title: 플러그인 적용 순서
doc_kind: solution
topic: markdown-parsing
status: active
created: 2026-06-03
tags: [tech/markdown-it, issue/regression]
related: [wikilink-inline-rule]
---

# 플러그인 적용 순서

인라인 룰을 어디에 끼우느냐로 결과가 달라진다. 코드 처리 뒤에 두어야
코드 안 표기를 건드리지 않는다. 순서를 바꾸면 조용히 회귀한다.
