---
title: 캐시가 뒤처졌다는 신호
doc_kind: adr
topic: agent-integration
status: active
created: 2026-07-04
tags: [tech/mcp, issue/stale-cache]
related: [mcp-server-contract, index-cache-invalidation]
---

# 캐시가 뒤처졌다는 신호

vault가 캐시보다 새로우면 응답에 그 사실을 실어 보낸다. 다만 막지는 않는다.

실패를 던지는 것 자체가 판단이다. 몇 건 뒤처진 게 결과에 영향을 주는지는
부르는 쪽이 안다. 서버는 사실만 알리고 판단하지 않는다.
