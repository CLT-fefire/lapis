---
title: 위키링크 인라인 룰
doc_kind: solution
topic: markdown-parsing
status: active
created: 2026-05-19
tags: [subject/editor, tech/markdown-it]
related: [code-fence-exclusion, link-resolver-ambiguity]
---

# 위키링크 인라인 룰

대괄호 두 겹을 링크로 바꾸는 인라인 룰을 파서에 끼운다. 룰 순서가 중요하다 —
코드 처리보다 앞에 두면 코드 안의 대괄호를 링크로 만들어 버린다.

제외 규칙은 [[code-fence-exclusion]]에, 경로 해석은 [[link-resolver-ambiguity]]에 있다.
