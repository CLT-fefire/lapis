---
title: 태그는 frontmatter에서만 읽는다
doc_kind: adr
topic: markdown-parsing
status: active
created: 2026-05-22
tags: [subject/tags, issue/regression]
related: [frontmatter-schema, code-fence-exclusion]
---

# 태그는 frontmatter에서만 읽는다

본문의 해시 기호는 태그로 읽지 않는다. 코드의 전처리기 지시문과 URL 조각을
태그와 구분할 신뢰할 방법이 없다.

그래서 태그는 앞머리 속성에서만 수집한다. 본문에 쓴 태그는 어디에도 잡히지 않는다 —
이건 버그가 아니라 결정이다.
