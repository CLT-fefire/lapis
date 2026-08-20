---
title: 부분 쓰기를 만들지 않는 저장
doc_kind: adr
topic: vault-storage
status: active
created: 2026-06-05
tags: [subject/vault, issue/atomic-write]
related: [backup-before-rewrite]
---

# 부분 쓰기를 만들지 않는 저장

## 규칙

임시 파일에 다 쓰고 이름을 바꿔 끼운다. 원본을 열어 덮어쓰지 않는다.
쓰다가 죽으면 원본이 그대로 남는다.

임시 파일은 같은 디렉터리에 만든다. 다른 파일시스템으로 옮기는 이름 바꾸기는
원자성이 보장되지 않는다. 실패하면 임시 파일을 지운다.
