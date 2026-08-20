---
title: 코드 안의 대괄호는 링크가 아니다
doc_kind: solution
topic: markdown-parsing
status: active
created: 2026-05-20
tags: [subject/editor, tech/markdown-it, issue/regression]
related: [wikilink-inline-rule]
---

# 코드 안의 대괄호는 링크가 아니다

## 증상

코드 블록에 쓴 타입 표기가 링크로 렌더됐다. 사용자가 쓴 건 코드지 링크가 아니다.

```swift
let payload: [[String: Any]] = []
```

위 블록 안의 대괄호는 링크로 잡히지 않아야 한다. 인라인 코드도 같다.
URL 조각도 태그가 아니다.

관련: [[wikilink-inline-rule]] · [[tag-extraction-policy]]
