---
title: frontmatter 스키마
doc_kind: adr
topic: markdown-parsing
status: active
created: 2026-05-21
tags: [subject/vault, subject/tags]
related: [tag-extraction-policy, related-vs-amends]
---

# frontmatter 스키마

문서 앞머리에 YAML로 속성을 둔다. 제목, 종류, 주제, 태그, 상호참조가 들어간다.

종류와 주제는 값 집합을 좁게 유지한다. 넓히면 속성으로 걸러내는 의미가 없다.
상호참조는 관계 종류를 보존한다 — [[related-vs-amends]] 참조.
