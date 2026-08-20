---
title: 다이어그램 렌더 경로
doc_kind: reference
topic: markdown-parsing
status: active
created: 2026-05-23
tags: [subject/export, tech/mermaid]
related: [html-export-inlining]
---

# 다이어그램 렌더 경로

코드 블록의 언어가 다이어그램이면 렌더러에 넘긴다. 색은 테마 토큰을 따라간다.

이미지로 내보낼 때 폰트가 빠지면 글자가 어긋난다. 내보내기 시점에
스타일을 함께 심는다. [[html-export-inlining]]과 같은 문제다.
