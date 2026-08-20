---
title: 테마 토큰
doc_kind: adr
topic: desktop-app
status: active
created: 2026-06-23
tags: [subject/editor, architecture/store-pattern]
related: [syntax-highlight-theme]
---

# 테마 토큰

색을 토큰 한 곳에 모은다. 컴포넌트가 색을 직접 적으면 테마를 바꿀 때
빠뜨리는 곳이 생긴다.

라이트와 다크를 각각 정의하고 시스템 설정을 따르는 모드를 하나 더 둔다.
