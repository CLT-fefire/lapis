---
title: 역참조 질의
doc_kind: solution
topic: agent-integration
status: active
created: 2026-07-03
tags: [tech/mcp, subject/graph]
related: [mcp-server-contract, backlink-first-navigation]
---

# 역참조 질의

## 이게 결정적인 이득이다

어떤 문서를 누가 가리키는지 찾는 일은 정규식으로는 여러 번 걸어야 하고
오탐이 섞인다. 인덱스를 이미 갖고 있으니 한 번의 호출로 정확히 답한다.

| 방법 | 호출 | 응답 크기 | 오탐 |
|---|---:|---:|---:|
| 정규식 | 3 | 15.9 KB | 3 |
| 역참조 질의 | 1 | 1.6 KB | 0 |

[[mcp-server-contract]] · [[backlink-first-navigation]] 참조.
