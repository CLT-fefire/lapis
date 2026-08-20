---
title: 디스크 캐시 shard
doc_kind: reference
topic: vault-storage
status: active
created: 2026-06-14
tags: [subject/search, architecture/shard-model]
related: [large-vault-performance, index-cache-invalidation]
---

# 디스크 캐시 shard

인덱스를 shard 단위로 디스크에 남긴다. 앱을 다시 켜도 전부 다시 읽지 않는다.
메타와 shard를 따로 저장해 일부만 갱신할 수 있게 한다.
