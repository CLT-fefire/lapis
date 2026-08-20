---
title: 같은 인자 같은 결과
doc_kind: adr
topic: agent-integration
status: active
created: 2026-07-06
tags: [tech/mcp, architecture/single-producer]
related: [mcp-server-contract]
---

# 같은 인자 같은 결과

질의 서버는 모델을 부르지 않는다. 같은 인자에 같은 결과를 돌린다.
재현되지 않는 응답은 디버깅할 수 없고, 결과를 신뢰할 근거도 없다.
