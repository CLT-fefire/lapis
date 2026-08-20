---
title: 파일 감시 창 묶기
doc_kind: solution
topic: vault-storage
status: active
created: 2026-06-09
tags: [subject/vault, issue/latency]
related: [incremental-index-update]
---

# 파일 감시 창 묶기

저장 한 번에 감시 이벤트가 여러 개 온다. 임시 파일 생성과 이름 바꾸기가
각각 잡힌다. 그대로 처리하면 인덱스를 여러 번 다시 세운다.

짧은 창 안의 이벤트를 모아 한 번만 처리한다. [[incremental-index-update]] 참조.
