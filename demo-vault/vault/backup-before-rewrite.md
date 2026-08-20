---
title: 고치기 전에 미리보기와 백업
doc_kind: adr
topic: vault-storage
status: active
created: 2026-06-11
tags: [subject/vault, issue/atomic-write]
related: [rename-link-rewrite, atomic-write-rename]
---

# 고치기 전에 미리보기와 백업

여러 파일을 고치는 작업은 실행 전에 무엇이 어떻게 바뀌는지 보여준다.
확인을 받고 나서 백업을 만들고 고친다.

되돌리기 비싼 작업 앞에는 항상 이 두 단계를 둔다. [[rename-link-rewrite]] 참조.
