---
title: 같은 이름이 여러 개일 때
doc_kind: solution
topic: markdown-parsing
status: active
created: 2026-05-26
tags: [subject/vault, issue/regression]
related: [wikilink-inline-rule, relative-path-links]
---

# 같은 이름이 여러 개일 때

이름만 적은 링크는 vault 안에 같은 이름이 둘 이상이면 어디로 갈지 모른다.

같은 디렉터리를 먼저 보고, 없으면 vault 전체에서 찾는다. 그래도 여럿이면
경로가 짧은 쪽을 고른다. 완벽하지 않아서 경로를 적는 편을 권한다.
