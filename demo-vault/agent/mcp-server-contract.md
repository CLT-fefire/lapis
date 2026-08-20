---
title: 지식 질의 서버 계약
doc_kind: adr
topic: agent-integration
status: active
created: 2026-07-02
tags: [tech/mcp, subject/search, architecture/single-producer]
related: [backlinks-query-design, stale-cache-signal, full-text-search-design]
---

# 지식 질의 서버 계약

## 위치

앱이 세운 인덱스를 에이전트가 읽을 수 있게 내보낸다. 서버는 캐시를 읽기만 하고
인덱스를 만들지 않는다 — 생산자는 하나여야 한다.

```mermaid
flowchart LR
  A[앱] -->|인덱스 생산| B[(디스크 캐시)]
  C[에이전트] -->|질의| D[질의 서버]
  D -->|읽기만| B
```

## 도구

도구는 하나다. 구조 질의와 본문 검색을 한 번의 호출로 답한다.
같은 인자에 같은 결과를 낸다 — 모델도 키도 쓰지 않는다.

[[backlinks-query-design]] · [[stale-cache-signal]] 참조.
