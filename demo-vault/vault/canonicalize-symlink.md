---
title: 심볼릭 링크 정규화
doc_kind: solution
topic: vault-storage
status: active
created: 2026-06-08
tags: [subject/vault, issue/path-traversal]
related: [path-traversal-guard]
---

# 심볼릭 링크 정규화

## 사고

심볼릭 링크를 실디렉터리로 가정하고 옮겼더니 원본이 비었다. 복사 백업도
링크만 복사해 백업이 아니었다.

## 처방

경로를 다루기 전에 정규화해 실제 대상을 확인한다. 링크 여부를 먼저 묻는다.
